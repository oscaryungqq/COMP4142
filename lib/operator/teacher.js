const Blockchain = require('../blockchain');
const R = require('ramda');

class Teacher{
    constructor(blockchain){
        this.blockchain = blockchain;
    }

    //Query attendance for a specific student by their student ID
    queryAttendance(studentId){

        const attendanceRecords = R.filter(
            (transaction) =>
                transaction.type === 'attendance' &&
                transaction.data.student_id === studentId,
            this.blockchain.getAllTransactions()
        );

        return attendanceRecords.map((record) => ({
            event_id: record.data.event_id,
            timestamp: record.data.timestamp,
        }));
    }

    //Query attendance for a class by the event ID
    queryClass_Attendance(eventId){

        const attendanceRecords = R.filter(
            (transaction) =>
                transaction.type === 'attendance' &&
                transaction.data.event_id === eventId,
            this.blockchain.getAllTransactions()
        );

        return attendanceRecords.map((record) => ({
            student_id: record.data.student_id,
            timestamp: record.data.timestamp,
        }));

}
}

module.exports = Teacher;
