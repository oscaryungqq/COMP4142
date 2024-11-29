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
        this.public_key = null;
        this.private_key = null;}

        student_register(blockchain){
 
        const secret = CryptoUtil.randomId();
        this.keyPair = CryptoEdDSAUtil.generateKeyPairFromSecret(secret);
        this.public_key = CryptoEdDSAUtil.toHex(this.keyPair.getPublic());
        this.private_key = CryptoEdDSAUtil.toHex(this.keyPair.getSecret());

        this.wallet.storeSecretKey(this.private_key);

        const registration_transaction = {
            id: CryptoUtil.randomId(),
            type: 'student-registration',
            data: {
                student_id: this.student_id,
                publicKey: this.public_key
            }
        };

        blockchain.addTransaction(registration_transaction);

        return registration_transaction;
    }

    record_attendance(event_id, blockchain){

        const timestamp = new Date().toISOString();
        const attendance_cert = {
            student_id: this.student_id,
            event_id: event_id,
            timestamp: timestamp,
        };

        const attendance_cert_hash = CryptoUtil.hash(attendance_cert);

        const signature = CryptoEdDSAUtil.signHash(this.keyPair, attendance_cert_hash);

        const attendanceTransaction = {
            id: CryptoUtil.randomId(),
            type: 'attendance',
            data: {
                student_id: this.student_id,
                event_id: event_id,
                timestamp: timestamp,
                signature: signature,
                publicKey: this.public_key,
            }
        };

        blockchain.addTransaction(attendanceTransaction);

        return attendanceTransaction;
    }

    mint(blockchain){

        const pending_transactions = blockchain.getAllTransactions();

        const attendance_transactions = pending_transactions.filter(tx => tx.type === 'attendance');

        const Valid_transactions = [];

        for(let transaction of attendance_transactions){
            
            const { student_id, event_id, timestamp, signature, publicKey } = transaction.data;

            const attendance_cert ={ student_id, event_id, timestamp };
            const cert_hash = CryptoUtil.hash(attendance_cert);

            const isValid = CryptoEdDSAUtil.verifySignature(publicKey, signature, cert_hash);

            if(isValid){
                Valid_transactions.push(transaction);
            }
        
        }

        if(Valid_transactions.length > 0){
            const previousBlock = blockchain.getLastBlock();
            const newBlockData ={
                index: previousBlock.index + 1,
                previousHash: previousBlock.hash,
                timestamp: new Date().toISOString(),
                transactions: Valid_transactions,
                miner: this.public_key,
                nonce: 0,
            };

            const newBlock = Block.fromJson(newBlockData);

            const reward_transaction = {
                id: CryptoUtil.randomId(),
                type: 'reward',
                data: {
                    inputs: [],
                    outputs:[
                        {
                            amount: Config.MINING_REWARD, 
                            address: this.public_key,
                        }
                    ]
                },
                hash:null
            };

            reward_transaction.hash = CryptoUtil.hash(reward_transaction.id + reward_transaction.type + JSON.stringify(reward_transaction.data));
            newBlock.transactions.push(reward_transaction);

            const difficulty = blockchain.getDifficulty(newBlock.index);
            const mined_Block = Miner.proveWorkFor(newBlock, difficulty);

            blockchain.addBlock(mined_Block);

            return newBlock;
        }

    }
}
module.exports = Student;