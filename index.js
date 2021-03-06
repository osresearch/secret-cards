/*
 * Untrusted server for the secret.cards system.
 *
 * This implements the broadcast mechanism used by the players to
 * shuffle, deal, and validate revealed cards.  It does not have
 * any secrets and is not able to influence the game play.
 * The server only relays all messages between clients; it does not
 * attempt to validate anything (right now).
 *
 * See SRA84 for the initial protocol, and the README.md for the
 * extensions to make it work without revealing all the cards,
 * as well as the multiplayer changes.
 *
 * During setup all of the players send in their public keys,
 * which are then re-broadcast
 */
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const sha256 = require('./sha256').sha256hex;


let players = {};

app.get('/', (req, res) => {
	res.sendFile(__dirname + "/index.html");
});
app.use(express.static('.'));

io.on('connection', (socket) => {
	console.log('connected');
	socket.on('disconnect', () => player_disconnect(socket))
	socket.on('register', (msg) => player_register(socket, msg));

	socket.on('chat', (msg) => {
		// ignore the signature; that is for others to verify
		console.log('chat:', msg.msg);
		io.emit('chat', msg);
	});
});

http.listen(4423, () => {
	console.log('listening on *:4423');
});


/*
 * Turn the ECDSA public key x and y coordinates into a hash
 */
function jwk2id(jwk)
{
	let id = jwk.x + "|" + jwk.y;
	return sha256(id.split(''));
}

/*
 * A new player is joining; the totals and let everyone know the current set
 * The msg should be a fully formed JWK signing key so that the other players
 * can validate the messages from this player.
 */
function player_register(socket, jwk)
{
	let id = jwk2id(jwk);
	if (socket.key)
	{
		console.log("replacing key");
		let old_id = jwk2id(socket.key);
		delete players[old_id];
	}

	socket.key = jwk;
	players[id] = jwk;

	io.emit('players', players);
	console.log(players);
}

function player_disconnect(socket)
{
	if (!socket.key)
		return;

	let old_id = jwk2id(socket.key);
	console.log('disconnect');
	delete players[old_id];

	// if they have registered a key, tell everyone
	// that they left, which means any in-progress games are over
	io.emit('disconnected', old_id);
}
