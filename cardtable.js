var socket = io();
let private_key = null;
let public_key = null;
let public_name = null;
let public_seq = 0; // todo: should this be a random nonce?
let players = {};

const key_param = {
	name: "ECDSA",
	namedCurve: "P-384",
	hash: { name: "SHA-256" },
};

function array2hex(bytes)
{
	return Array.from(new Uint8Array(bytes))
		.map( c => ('00' + c.toString(16)).slice(-2) )
		.join('');
}

function hex2array(s)
{
	let bytes = [];
	for(let i = 0 ; i < s.length ; i += 2)
		bytes.push(parseInt(s.substr(i, 2), 16));
	return new Uint8Array(bytes);
}

/*
 * Turn the ECDSA public key x and y coordinates into a hash
 */
function jwk2id(jwk)
{
	let id = jwk.x + "|" + jwk.y;
	return sha256.sha256hex(id.split(''));
}


function removeElement(id)
{
	let it = document.getElementById(id);
	if (it)
		it.remove();
}

function getEncoding(msg)
{
	return new TextEncoder().encode(msg);
}


// generate a signature on the msg, including the sequence number
// and the public key used to sign it, and send it when it is ready
function send_signed(dest,  msg)
{
	let signed_msg = {
		msg: msg,
		seq: public_seq++,
		key: public_name,
	};

	window.crypto.subtle.sign(
		key_param,
		private_key,
		getEncoding(JSON.stringify(signed_msg))
	).then((sig) => {
		let sig_hex = array2hex(sig);
		console.log(dest, signed_msg, sig, sig_hex);

		// add the signature to the signed message and send it
		signed_msg.sig = sig_hex;
		socket.emit(dest, signed_msg);
	});
}


/*
 * When the socket connects, attempt to register our key
 * with the server.
 */
socket.on('connect', () => {
	if (public_key)
	{
		console.log("RECONNECTED");
		socket.emit('register', public_key);
		return;
	}

	console.log("FIRST CONNECT");
	window.crypto.subtle.generateKey(
		key_param,
		true,
		["sign", "verify"]
	).then((k) => {
		console.log("Key created", k);
		private_key = k.privateKey;
		return window.crypto.subtle.exportKey('jwk', k.publicKey);
	}).then((jwk) => {
		public_key = jwk;
		public_name = jwk2id(jwk);
		socket.emit('register', jwk);
	});

	// setup the chat box
	let messages = document.getElementById('messages');
	let form = document.getElementById('form');
	let input = document.getElementById('input');

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		if (!input.value)
			return;

		send_signed('chat', input.value);
		input.value = '';
	});

});

async function async_false() { return false }


function recv_signed(msg)
{
	let player = players[msg.key];
	if (!player)
	{
		console.log("UNKNOWN PLAYER:", msg);
		return async_false();
	}

	if (player.seq >= 0 && msg.seq != player.seq + 1)
	{
		console.log("SEQ MISMATCH", player.seq + 1, msg);
		return async_false();
	}

	let signed_msg = JSON.stringify({
		msg: msg.msg,
		seq: msg.seq,
		key: msg.key,
	});
	console.log("signed=", signed_msg);

	return window.crypto.subtle.verify(
		key_param,
		player.key,
		hex2array(msg.sig),
		getEncoding(signed_msg)
	).then((valid) => {
		if (valid)
		{
			player.seq = msg.seq;
		} else {
			player.cheats++;
		}

		player_update(player.id);
		return valid;
	});
;
}


// attempt to validate the signature on the message
// todo: check sequence number, match to existing player
socket.on('chat', (msg) => recv_signed(msg).then((valid) => {
	var item = document.createElement('li');
	if (!valid)
	{
		item.textContent = '❌ ' + msg.msg;
	} else {
		item.textContent = '✓ ' + msg.msg;
	}

	messages.appendChild(item);
	window.scrollTo(0, document.body.scrollHeight);
}));

function player_update(id)
{
	document.getElementById("player-sequence-"+id).textContent = players[id].seq;
}

socket.on('players', (new_player_list) => {
	// update the list of players
	// todo: if there is a game in
	// action we need to signal an abnormal exit since no new players
	// should join or current players should leave
	// todo: detect a player leaving during game play

	let player_list = document.getElementById('players');
	console.log(new_player_list);

	let new_players = {};
	for(let new_player of new_player_list)
	{
		// don't trust the server's hash; do it ourselves
		let id = jwk2id(new_player);
		new_player.id = id;
		new_player.seq = -1;
		new_player.cheats = 0;
		new_players[id] = new_player;
	}

	// check to see if any player id's have gone away
	for(let id in players)
	{
		if (id in new_players)
			continue;

		// todo: cancel a game in progress
		delete players[id];
		removeElement("player-"+id);
	}

	// add in any new player id's
	for(let id in new_players)
	{
		if (id in players)
			continue;

		let player = new_players[id];

		// new player has joined; import their public key
		// todo: add them in observer mode
		players[id] = player;
		window.crypto.subtle.importKey(
			'jwk',
			player,
			key_param,
			true,
			player.key_ops // [ 'verify' ]
		).then((player_pub) => {
			player.key = player_pub;
		});

		// add them to the player list
		let it = document.createElement('li');
		it.setAttribute("id", "player-" + id);

		let seq = document.createElement('span');
		seq.setAttribute("class", "player-sequence");
		seq.setAttribute("id", "player-sequence-" + id);
		seq.textContent = '--';
		let id_name = document.createElement('span');
		id_name.setAttribute("class", "player-name");
		id_name.textContent = id;

		it.appendChild(seq);
		it.appendChild(id_name);
		player_list.appendChild(it);
	}

	// update the total player count
	let counter = document.getElementById('playerCount');
	counter.textContent = Object.keys(players).length;
});
