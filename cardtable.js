var socket = io();
let private_key = null;
let public_key = null;
let players = null;

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

function getEncoding(msg)
{
	return new TextEncoder().encode(msg);
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
		let msg = input.value;
		input.value = '';

		// generate a signature on the msg
		// and send it when it is ready
		window.crypto.subtle.sign(
			key_param,
			private_key,
			getEncoding(msg)
		).then((sig) => {
			let sig_hex = array2hex(sig);
			console.log("chat:", msg, sig, sig_hex);
			socket.emit('chat', {
				msg: msg,
				sig: sig_hex,
				key: public_key,
			});
		});
	});
});


// attempt to validate the signature on the message
// todo: check sequence number, match to existing player
socket.on('chat', (msg) => {
	window.crypto.subtle.importKey(
		'jwk',
		msg.key,
		key_param,
		true,
		msg.key.key_ops // [ 'verify' ]
	).then((msg_key) => window.crypto.subtle.verify(
		key_param,
		msg_key,
		hex2array(msg.sig),
		getEncoding(msg.msg),
	)).then((result) => {
		var item = document.createElement('li');
		if (result)
			item.textContent = '✓ ' + msg.msg;
		else
			item.textContent = '❌ ' + msg.msg;

		messages.appendChild(item);
		window.scrollTo(0, document.body.scrollHeight);
	});
});

socket.on('players', (new_players) => {
	// update the list of players; if there is a game in
	// action we need to signal an abnormal exit
	players = new_players;
	console.log(players);
	let counter = document.getElementById('playerCount');
	counter.textContent = Object.keys(players).length;
});
