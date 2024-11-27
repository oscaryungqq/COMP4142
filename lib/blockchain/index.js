const EventEmitter = require('events');
const R = require('ramda');
const Db = require('../util/db');
const Blocks = require('./blocks');
const Block = require('./block');
const Transactions = require('./transactions');
const TransactionAssertionError = require('./transactionAssertionError');
const BlockAssertionError = require('./blockAssertionError');
const BlockchainAssertionError = require('./blockchainAssertionError');
const Config = require('../config');
const { Certificate } = require('crypto');
const BLOCK_INTERVAL = 600; // Target time between blocks (in seconds) - 10 minutes
const DIFFICULTY_ADJUSTMENT_INTERVAL = 10; // Number of blocks between difficulty adjustments
const DIFFICULTY_ADJUSTMENT_FACTOR = 2; // How much to adjust difficulty by

// Database settings
const BLOCKCHAIN_FILE = 'blocks.json';
const TRANSACTIONS_FILE = 'transactions.json';

class Blockchain {
    constructor(dbName) {
        this.blocksDb = new Db('data/' + dbName + '/' + BLOCKCHAIN_FILE, new Blocks());
        this.transactionsDb = new Db('data/' + dbName + '/' + TRANSACTIONS_FILE, new Transactions());

        // INFO: In this implementation the database is a file and every time data is saved it rewrites the file, probably it should be a more robust database for performance reasons
        this.blocks = this.blocksDb.read(Blocks);
        this.transactions = this.transactionsDb.read(Transactions);

        // Some places uses the emitter to act after some data is changed
        this.emitter = new EventEmitter();
        this.init();
    }

    init() {
        // Create the genesis block if the blockchain is empty
        if (this.blocks.length == 0) {
            console.info('Blockchain empty, adding genesis block');
            this.blocks.push(Block.genesis);
            this.blocksDb.write(this.blocks);
        }

        // Remove transactions that are in the blockchain
        console.info('Removing transactions that are in the blockchain');
        R.forEach(this.removeBlockTransactionsFromTransactions.bind(this), this.blocks);
    }

    getAllBlocks() {
        return this.blocks;
    }

    getBlockByIndex(index) {
        return R.find(R.propEq('index', index), this.blocks);
    }

    getBlockByHash(hash) {
        return R.find(R.propEq('hash', hash), this.blocks);
    }

    getLastBlock() {
        return R.last(this.blocks);
    }

getDifficulty(index) {
    // Special case for genesis block
    if (index === 0) return Config.pow.difficulty;

    // Only adjust difficulty at intervals
    if (index % DIFFICULTY_ADJUSTMENT_INTERVAL !== 0) {
        return this.blocks[this.blocks.length - 1].difficulty || Config.pow.difficulty;
    }

    const prevAdjustmentBlock = this.blocks[Math.max(0, this.blocks.length - DIFFICULTY_ADJUSTMENT_INTERVAL)];
    const timeExpected = BLOCK_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL;
    const timeTaken = this.blocks[this.blocks.length - 1].timestamp - prevAdjustmentBlock.timestamp;

    console.log('Difficulty Adjustment:');
    console.log('Time Expected:', timeExpected);
    console.log('Time Taken:', timeTaken);
    console.log('Current Difficulty:', prevAdjustmentBlock.difficulty);

    let newDifficulty = prevAdjustmentBlock.difficulty || Config.pow.difficulty;

    // Adjust difficulty based on time taken
    if (timeTaken < timeExpected / 2) {
        console.log('Mining too fast - Increasing difficulty');
        newDifficulty *= 2;
    } else if (timeTaken > timeExpected * 2) {
        console.log('Mining too slow - Decreasing difficulty');
        newDifficulty /= 2;
    }

    console.log('New Difficulty:', newDifficulty);
    return Math.max(Config.pow.difficulty, newDifficulty);
}

    getAllTransactions() {
        return this.transactions;
    }

    getTransactionById(id) {
        return R.find(R.propEq('id', id), this.transactions);
    }

    getTransactionFromBlocks(transactionId) {
        return R.find(R.compose(R.find(R.propEq('id', transactionId)), R.prop('transactions')), this.blocks);
    }

    replaceChain(newBlockchain) {
        // It doesn't make sense to replace this blockchain by a smaller one
        if (newBlockchain.length <= this.blocks.length) {
            console.error('Blockchain shorter than the current blockchain');
            throw new BlockchainAssertionError('Blockchain shorter than the current blockchain');
        }

        // Verify if the new blockchain is correct
        this.checkChain(newBlockchain);

        // Get the blocks that diverges from our blockchain
        console.info('Received blockchain is valid. Replacing current blockchain with received blockchain');
        let newBlocks = R.takeLast(newBlockchain.length - this.blocks.length, newBlockchain);

        // Add each new block to the blockchain
        R.forEach((block) => {
            this.addBlock(block, false);
        }, newBlocks);

        this.emitter.emit('blockchainReplaced', newBlocks);
    }

    checkChain(blockchainToValidate) {
        // Check if the genesis block is the same
        if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(Block.genesis)) {
            console.error('Genesis blocks aren\'t the same');
            throw new BlockchainAssertionError('Genesis blocks aren\'t the same');
        }

        // Compare every block to the previous one (it skips the first one, because it was verified before)
        try {
            for (let i = 1; i < blockchainToValidate.length; i++) {
                this.checkBlock(blockchainToValidate[i], blockchainToValidate[i - 1], blockchainToValidate);
            }
        } catch (ex) {
            console.error('Invalid block sequence');
            throw new BlockchainAssertionError('Invalid block sequence', null, ex);
        }
        return true;
    }

    addBlock(newBlock, emit = true) {
        // It only adds the block if it's valid (we need to compare to the previous one)
        if (this.checkBlock(newBlock, this.getLastBlock())) {
            // Set the difficulty for the new block before adding it
            newBlock.difficulty = this.getDifficulty(newBlock.index);
            
            // Add timestamp if not already set
            if (!newBlock.timestamp) {
                newBlock.timestamp = Math.floor(Date.now() / 1000);
            }
    
            this.blocks.push(newBlock);
            this.blocksDb.write(this.blocks);
    
            // After adding the block it removes the transactions of this block from the list of pending transactions
            this.removeBlockTransactionsFromTransactions(newBlock);
    
            console.info(`Block added: ${newBlock.hash}`);
            console.info(`Block difficulty: ${newBlock.difficulty}`);
            console.debug(`Block added: ${JSON.stringify(newBlock)}`);
            if (emit) this.emitter.emit('blockAdded', newBlock);
    
            return newBlock;
        }
    }

    //changed method for attendance and registration transactions
    addTransaction(newTransaction, emit = true) {
        //check if the transaction type is 'student-registration'
        if(newTransaction.type == 'student-registration'){
            //Validate the registration transaction fields
            if(!newTransaction.data.student_id || !newTransaction.data.publicKey){
                console.error('Invalid registration transaction fields');
                throw new Error('Invalid registration transaction');
            }

            //Add the transaction to the blockchain
            this.transactions.push(newTransaction);
            this.transactionsDb.write(this.transactions);

            //Log the successful registration message
            console.info(`Student registration added: ${newTransaction.data.student_id}`);
            console.debug(`Student registration added: ${JSON.stringify(newTransaction)}`);
            if (emit) this.emitter.emit('studentRegistered', newTransaction);

            return newTransaction;
        }

        //check if the transaction type is 'attendance'
        if(newTransaction.type == 'attendance'){
            //Validate the attendance transaction fields
            if(!newTransaction.data.student_id || !newTransaction.data.event_id || !newTransaction.data.timestamp || !newTransaction.data.signature){
                console.error('Invalid attendance transaction fields');
                throw new Error('Invalid attendance transaction');
            }

            //Add the transaction to the blockchain
            this.transactions.push(newTransaction);
            this.transactionsDb.write(this.transactions);

            //Log the successful attendance message
            console.info(`Attendance recorded: ${newTransaction.data.student_id}`);
            console.debug(`Attendance recorded: ${JSON.stringify(newTransaction)}`);
            if (emit) this.emitter.emit('attendanceRecorded', newTransaction);

            return newTransaction;
        }

        // It only adds the transaction if it's valid
        if (this.checkTransaction(newTransaction, this.blocks)) {
            this.transactions.push(newTransaction);
            this.transactionsDb.write(this.transactions);

            console.info(`Transaction added: ${newTransaction.id}`);
            console.debug(`Transaction added: ${JSON.stringify(newTransaction)}`);
            if (emit) this.emitter.emit('transactionAdded', newTransaction);

            return newTransaction;
        }
    }

    removeBlockTransactionsFromTransactions(newBlock) {
        this.transactions = R.reject((transaction) => { return R.find(R.propEq('id', transaction.id), newBlock.transactions); }, this.transactions);
        this.transactionsDb.write(this.transactions);
    }

    checkBlock(newBlock, previousBlock, referenceBlockchain = this.blocks) {
        const blockHash = newBlock.toHash();

        // Basic block validation checks
        if (previousBlock.index + 1 !== newBlock.index) {
            console.error(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
            throw new BlockAssertionError(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
        } 
        
        if (previousBlock.hash !== newBlock.previousHash) {
            console.error(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
            throw new BlockAssertionError(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
        } 
        
        if (blockHash !== newBlock.hash) {
            console.error(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
            throw new BlockAssertionError(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
        }

        // Dynamic difficulty check
        const currentDifficulty = this.getDifficulty(newBlock.index);
        const blockDifficulty = newBlock.getDifficulty();
        
        if (blockDifficulty > currentDifficulty) {
            console.error(`Invalid proof-of-work difficulty: hash difficulty '${blockDifficulty}' is greater than required difficulty '${currentDifficulty}'`);
            throw new BlockAssertionError(`Invalid proof-of-work difficulty: hash difficulty '${blockDifficulty}' is greater than required difficulty '${currentDifficulty}'`);
        }

        // Transaction validation
        R.forEach(this.checkTransaction.bind(this), newBlock.transactions, referenceBlockchain);

        // Check block balance
        let sumOfInputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('inputs'), R.prop('data')), newBlock.transactions))) + Config.MINING_REWARD;
        let sumOfOutputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('outputs'), R.prop('data')), newBlock.transactions)));

        let isInputsAmountGreaterOrEqualThanOutputsAmount = R.gte(sumOfInputsAmount, sumOfOutputsAmount);

        if (!isInputsAmountGreaterOrEqualThanOutputsAmount) {
            console.error(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`);
            throw new BlockAssertionError(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`, { sumOfInputsAmount, sumOfOutputsAmount });
        }

        // Check for double spending
        let listOfTransactionIndexInputs = R.flatten(R.map(R.compose(R.map(R.compose(R.join('|'), R.props(['transaction', 'index']))), R.prop('inputs'), R.prop('data')), newBlock.transactions));
        let doubleSpendingList = R.filter((x) => x >= 2, R.map(R.length, R.groupBy(x => x)(listOfTransactionIndexInputs)));

        if (R.keys(doubleSpendingList).length) {
            console.error(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
            throw new BlockAssertionError(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
        }

        // Check transaction types
        let transactionsByType = R.countBy(R.prop('type'), newBlock.transactions);
        
        if (transactionsByType.fee && transactionsByType.fee > 1) {
            console.error(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
            throw new BlockAssertionError(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
        }

        if (transactionsByType.reward && transactionsByType.reward > 1) {
            console.error(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
            throw new BlockAssertionError(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
        }

        return true;
}

    checkTransaction(transaction, referenceBlockchain = this.blocks) {

        if (!transaction.data || !transaction.data.inputs || !transaction.data.outputs) {
            console.error(`Transaction data is missing or improperly formatted: ${JSON.stringify(transaction)}`);
            throw new TransactionAssertionError('Invalid transaction data structure.', transaction);
        }
        
        // Check the transaction
        transaction.check(transaction);

        // Verify if the transaction isn't already in the blockchain
        let isNotInBlockchain = R.all((block) => {
            return R.none(R.propEq('id', transaction.id), block.transactions);
        }, referenceBlockchain);

        if (!isNotInBlockchain) {
            console.error(`Transaction '${transaction.id}' is already in the blockchain`);
            throw new TransactionAssertionError(`Transaction '${transaction.id}' is already in the blockchain`, transaction);
        }

        // Verify if all input transactions are unspent in the blockchain
        let isInputTransactionsUnspent = R.all(R.equals(false), R.flatten(R.map((txInput) => {
            return R.map(
                R.pipe(
                    R.prop('transactions'),
                    R.map(R.pipe(
                        R.path(['data', 'inputs']),
                        R.contains({ transaction: txInput.transaction, index: txInput.index })
                    ))
                ), referenceBlockchain);
        }, transaction.data.inputs)));

        if (!isInputTransactionsUnspent) {
            console.error(`Not all inputs are unspent for transaction '${transaction.id}'`);
            throw new TransactionAssertionError(`Not all inputs are unspent for transaction '${transaction.id}'`, transaction.data.inputs);
        }

        return true;
    }

    getUnspentTransactionsForAddress(address) {
        const selectTxs = (transaction) => {
            let index = 0;
            // Create a list of all transactions outputs found for an address (or all).
            R.forEach((txOutput) => {
                if (address && txOutput.address == address) {
                    txOutputs.push({
                        transaction: transaction.id,
                        index: index,
                        amount: txOutput.amount,
                        address: txOutput.address
                    });
                }
                index++;
            }, transaction.data.outputs);

            // Create a list of all transactions inputs found for an address (or all).            
            R.forEach((txInput) => {
                if (address && txInput.address != address) return;

                txInputs.push({
                    transaction: txInput.transaction,
                    index: txInput.index,
                    amount: txInput.amount,
                    address: txInput.address
                });
            }, transaction.data.inputs);
        };

        // Considers both transactions in block and unconfirmed transactions (enabling transaction chain)
        let txOutputs = [];
        let txInputs = [];
        R.forEach(R.pipe(R.prop('transactions'), R.forEach(selectTxs)), this.blocks);
        R.forEach(selectTxs, this.transactions);

        // Cross both lists and find transactions outputs without a corresponding transaction input
        let unspentTransactionOutput = [];
        R.forEach((txOutput) => {
            if (!R.any((txInput) => txInput.transaction == txOutput.transaction && txInput.index == txOutput.index, txInputs)) {
                unspentTransactionOutput.push(txOutput);
            }
        }, txOutputs);

        return unspentTransactionOutput;
    }

    //new method for clear all transaction facilitate the testing 
    clearAllTransactions() {
        console.info('Clearing all pending transactions...');
        this.transactions = [];
        this.transactionsDb.write(this.transactions);
    }
    
}

module.exports = Blockchain;
