/*
 * Untrusted server for the secret.cards system.
 *
 * This implements the broadcast mechanism used by the peers to
 * shuffle, deal, and validate revealed cards.  It does not have
 * any secrets and is not able to influence the game play.
 * The server only relays all messages between clients; it does not
 * attempt to validate anything (right now).
 * It is also not trusted by the players.
 *
 * See SRA84 for the initial protocol, and the README.md for the
 * extensions to make it work without revealing all the cards,
 * as well as the multipeer changes.
 *
 * During setup all of the peers send in their public keys,
 * which are then re-broadcast as the peer array.  The server
 * does not interpret them at all.
 *
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
	socket.on('disconnect', () => {
		try {
			peer_disconnect(socket, true);
		} catch (err) {
			console.log(socket.handshake.address, "disconnect", err);
		}
	});
	socket.on('register', (msg) => {
		try {
			peer_register(socket, msg);
		} catch (err) {
			console.log(socket.handshake.address, "register", err);
		}
	});

	// broadcast all incoming messages from any peer.
	// ignore the signature; that is for others to verify
	for(let topic of ["chat", "shuffle", "draw", "encrypt", "decrypt", "reveal", "move"])
	{
		socket.on(topic, (msg) => { try {
			// if there is no room yet, then do not allow any messages
			const room = socket.room
			if (!room)
				return;

			console.log(room + ": " + socket.name + "." + msg.seq + ": " + topic + "=", msg.msg);
			io.to(room).emit(topic, msg);
		} catch(err) {
			console.log(socket.handshake.address, topic, err);
		}});
	}
});

http.listen(process.env.PORT || 4423, () => {
	console.log('listening');
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
function peer_register(socket, msg)
{
	let id = jwk2id(msg.jwk);
	let name = words("0x" + id);

	// sanitize the room name to only be normal characters
	const room = msg.room;
	if ((/[^-\w]/.test(room))) {
		console.log(name + ": invalid room name", room);
		return;
	}

	if (socket.key)
	{
		// disconnect the old key (and update the room if
		// the room has changed)
		peer_disconnect(socket, room != socket.room);
	}

	socket.join(room);
	socket.room = room;
	socket.name = name;
	socket.key = msg.jwk;

	if (!(room in peers))
		peers[room] = {};

	peers[room][name] = msg.jwk;

	console.log(room + ': register', name);

	io.to(room).emit('peers', Object.values(peers[room]));
	console.log(room + ': peers', Object.keys(peers[room]));
}

function peer_disconnect(socket,notify=true)
{
	if (!socket.key)
		return;

	let room = socket.room;
	let id = jwk2id(socket.key);
	let name = words("0x" + id);
	console.log(room + ': disconnect', name);
	delete peers[room][name];

	// if there is no one left in this room, delete it
	if (Object.keys(peers[room]).length == 0)
	{
		console.log(room + ": last one out turn out the lights");
		delete peers[room];
		return;
	}

	// if they have registered a new key, tell everyone in the old room
	if (!notify)
		return;

	io.to(room).emit('peers', Object.values(peers[room]));
	console.log(room + ': peers', Object.keys(peers[room]));
}
