const Blockchain = require('../blockchain');
const R = require('ramda');

class Teacher{
    constructor(blockchain){
        this.blockchain = blockchain;
    }

    query_attendance(student_id){

        const attendanceRecords = R.filter(
            (transaction) =>
                transaction.type === 'attendance' &&
                transaction.data.student_id === student_id,
            this.blockchain.getAllTransactions()
        );

        return attendanceRecords.map((record) => ({
            event_id: record.data.event_id,
            timestamp: record.data.timestamp,
        }));
    }

    query_class(event_id){

        const attendance_records = R.filter(
            (transaction) =>
                transaction.type === 'attendance' &&
                transaction.data.event_id === event_id,
            this.blockchain.getAllTransactions()
        );

        return attendance_records.map((record) => ({
            student_id: record.data.student_id,
            timestamp: record.data.timestamp,
        }));

}
}

module.exports = Teacher;
