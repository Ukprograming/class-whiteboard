const io = require("socket.io-client");
const socket = io("http://localhost:3000");

socket.on("connect", () => {
    console.log("Test student connected");
    socket.emit("join-class", { classCode: "TEST_LIST", nickname: "TestStudent" });
});

socket.on("join-success", () => {
    console.log("Test student joined class TEST_LIST");
});

// Keep alive
setInterval(() => { }, 1000);
