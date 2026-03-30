require('dotenv').config();
const { readPassengers } = require('./src/services/statistics');
(async () => {
    try {
        const pass = await readPassengers();
        if (pass.length > 0) {
            console.log("Keys of a passenger:", Object.keys(pass[0]));
            if (pass.length > 1) console.log("Keys of passenger 2:", Object.keys(pass[1]));
        } else {
            console.log("passengers table is empty");
        }
        process.exit(0);
    } catch(err) {
        console.error("Error", err);
        process.exit(1);
    }
})();
