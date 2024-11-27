const Wallet = require('./wallet');
const CryptoEdDSAUtil = require('../util/cryptoEdDSAUtil');
const CryptoUtil = require('../util/cryptoUtil');
const Blockchain = require('../blockchain');
const Config = require('../config');
const Block = require('../blockchain/block');
const Miner = require('../miner')

class Student{
    constructor(student_id){
        this.student_id = student_id;
        this.wallet = new Wallet();
        this.keyPair = null;
        this.publicKey = null;
        this.privateKey = null;}

        register(blockchain){

        // First generate a random secret and the key pair during registration
        const secret = CryptoUtil.randomId();
        this.keyPair = CryptoEdDSAUtil.generateKeyPairFromSecret(secret);
        this.publicKey = CryptoEdDSAUtil.toHex(this.keyPair.getPublic());
        this.privateKey = CryptoEdDSAUtil.toHex(this.keyPair.getSecret());

        // Store the secret key in the wallet
        this.wallet.storeSecretKey(this.privateKey);

        // Build the student registration data for blockchain
        const registrationTransaction = {
            id: CryptoUtil.randomId(),
            type: 'student-registration',
            data: {
                student_id: this.student_id,
                publicKey: this.publicKey
            }
        };

        //Need to ask the addTransaction method's checking to let is pass
        // the addtransaction method defined in the blockchain.js file by original author
        blockchain.addTransaction(registrationTransaction);

        //Return the registration transaction for verification
        return registrationTransaction;
    }

    recordAttendance(event_id, blockchain){

        if(!this.keyPair){
            throw new Error("Student must be registered before recording attendance");
        }

        //create attendance certificate
        const timestamp = new Date().toISOString();
        const attendance_cert = {
            student_id: this.student_id,
            event_id: event_id,
            timestamp: timestamp,
        };

        //Hash the attendance certificate for signing
        const attendance_cert_hash = CryptoUtil.hash(attendance_cert);

        //Sign the attendance certificate hash
        const signature = CryptoEdDSAUtil.signHash(this.keyPair, attendance_cert_hash);

        //Build attendance transaction data
        const attendanceTransaction = {
            id: CryptoUtil.randomId(),
            type: 'attendance',
            data: {
                student_id: this.student_id,
                event_id: event_id,
                timestamp: timestamp,
                signature: signature,
                publicKey: this.publicKey, //Include public key for verification afterwards
            }
        };

        // Record the transaction on the blockchain
        // Again need to ask the addTransaction method's checking to let is pass
        blockchain.addTransaction(attendanceTransaction);

        //Return the registration transaction for verification
        return attendanceTransaction;
    }

    mint(blockchain){
        //Get pending transactions from the blockchain
        const pending_Transactions = blockchain.getAllTransactions();
        
        if (!Array.isArray(pending_Transactions)) {
            throw new Error("Pending transactions are not in array format");
        }

        //filter only attendance transactions
        const attendanceTransactions = pending_Transactions.filter(tx => tx.type === 'attendance');

        // initialize array to hold valid transactions
        const Valid_transactions = [];
        const Invalid_transactions = [];

        //Iterate through each transaction for verification
        for(let transaction of attendanceTransactions){

            
            //get data from the transaction
            const { student_id, event_id, timestamp, signature, publicKey } = transaction.data;

            //recreate the attendance certificate hash
            const attendance_cert ={ student_id, event_id, timestamp };
            const cert_hash = CryptoUtil.hash(attendance_cert);

            //Verify the signature
            const isValid = CryptoEdDSAUtil.verifySignature(publicKey, signature, cert_hash);

            if(isValid){
                Valid_transactions.push(transaction);
            }else{
                console.error(`Invalid transaction: Signature verification failed. Transaction ID: ${transaction.id}`);
                Invalid_transactions.push(transaction);
            }
        
        }

        //Create a new block with valid transactions
        if(Valid_transactions.length > 0){
            const previousBlock = blockchain.getLastBlock();
            const newBlockData ={
                index: previousBlock.index + 1,
                previousHash: previousBlock.hash,
                timestamp: new Date().toISOString(),
                transactions: Valid_transactions,
                miner: this.publicKey, //Reward the student for minting the block
                nonce: 0,
            };

            const newBlock = Block.fromJson(newBlockData);

            //Add reward transaction for the student
            const rewardTransaction = {
                id: CryptoUtil.randomId(),
                type: 'reward',
                data: {
                    inputs: [],
                    outputs:[
                        {
                            amount: Config.MINING_REWARD, 
                            // Reward amount is defined by the original author
                            // It is in the config.js file
                            address: this.publicKey,
                        }
                    ]
                },
                hash:null
            };

            // Compute the hash for the reward transaction
            rewardTransaction.hash = CryptoUtil.hash(rewardTransaction.id + rewardTransaction.type + JSON.stringify(rewardTransaction.data));
            newBlock.transactions.push(rewardTransaction);


            // Mine the block using the proof of work algorithm
            const difficulty = blockchain.getDifficulty(newBlock.index);
            const mined_Block = Miner.proveWorkFor(newBlock, difficulty);

            // Add the new block to the blockchain
            blockchain.addBlock(mined_Block);

            console.log(`Block mined successfully by student: ${this.student_id}, reward: ${Config.MINING_REWARD}`);
            return newBlock;
        }else{
            console.warn('No valid transactions to mine');
            return null;
        }

    }
}
module.exports = Student;