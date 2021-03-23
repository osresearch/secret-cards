/*
 * Untrusted server for the secret.cards system.
 *
 * This implements the broadcast mechanism used by the peers to
 * shuffle, deal, and validate revealed cards.  It does not have
 * any secrets and is not able to influence the game play.
 * The server only relays all messages between clients; it does not
 * attempt to validate anything (right now).
 *
 * See SRA84 for the initial protocol, and the README.md for the
 * extensions to make it work without revealing all the cards,
 * as well as the multipeer changes.
 *
 * During setup all of the peers send in their public keys,
 * which are then re-broadcast as the peer array.  The server
 * does not interpret them at all.
 *
 * Initially all the cards are "face up", which allows the peers
 * to agree on the number and contents.  A peer can propose a
 * shuffling of a subset of the cards, along with the set of
 * peers to play the game.
 *
 * (This can be done at any time as well with partial decks,
 * to allow remixing of things, etc, although reshuffling face up
 * and facedown cards needs to be worked out)
 */
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const sha256 = require('./sha256').sha256hex;
const words = require('./words').bigint2words;

let peers = {};

app.get('/', (req, res) => {
	res.sendFile(__dirname + "/index.html");
});
app.use(express.static('.'));

io.on('connection', (socket) => {
	console.log('connected', socket.handshake.address);
	socket.on('disconnect', () => peer_disconnect(socket, true))
	socket.on('register', (msg) => peer_register(socket, msg));

	// broadcast all incoming messages from any peer.
	// ignore the signature; that is for others to verify
	for(let topic of ["chat", "shuffle", "draw", "encrypt", "decrypt", "reveal"])
	{
		socket.on(topic, (msg) => {
			console.log(socket.name + "." + msg.seq + ": " + topic + "=", msg.msg);
			io.emit(topic, msg);
		});
	}
});

http.listen(4423, () => {
	console.log('listening on *:4423');
});

/*
 * Turn the ECDSA public key x and y coordinates into a hash
 * This does not have to match the one used by the clients.
 */
function jwk2id(jwk)
{
	let id = jwk.x + "|" + jwk.y;
	return sha256(id.split(''));
}


/*
 * A new peer is joining; the totals and let everyone know the current set
 * The msg should be a fully formed JWK signing key so that the other peers
 * can validate the messages from this peer.
 */
function peer_register(socket, jwk)
{
	let id = jwk2id(jwk);
	let name = words("0x" + id);
	if (socket.key)
		peer_disconnect(socket, false);

	socket.key = jwk;
	socket.name = name;
	peers[name] = jwk;
	console.log('register', name);

	io.emit('peers', Object.values(peers));
	console.log('peers', Object.keys(peers));
}

function peer_disconnect(socket,notify=true)
{
	if (!socket.key)
		return;

	let id = jwk2id(socket.key);
	let name = words("0x" + id);
	console.log('disconnect', name);
	delete peers[name];

	// if they have registered a key, tell everyone
	// that they left, which means any in-progress games are over
	if (!notify)
		return;

	io.emit('peers', Object.values(peers));
	console.log('peers', Object.keys(peers));
}
