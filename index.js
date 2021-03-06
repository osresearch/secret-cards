const app = require('express')();
const http = require('http').createServer(app);

app.get('/', (req, res) => {
	//res.send('<h1>Hello world</h1>');
	res.sendFile(__dirname + "/index.html");
});

http.listen(4423, () => {
	console.log('listening on *:4423');
});
