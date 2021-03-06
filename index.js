const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => {
	//res.send('<h1>Hello world</h1>');
	res.sendFile(__dirname + "/index.html");
});

io.on('connection', (socket) => {
	console.log('connected');
});

http.listen(4423, () => {
	console.log('listening on *:4423');
});
