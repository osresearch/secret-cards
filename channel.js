/*
 * Secure channel communications between the players.
 * No card logic goes in here, although the player array is shared
 * with the card table, and the dealing uses the socket io messages.
 */
"use strict"

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


function getEncoding(msg)
{
	return new TextEncoder().encode(msg);
}


class SecureChannel
{
	constructor()
	{
		this.socket = io();
		this.private_key = null;
		this.public_key = null;
		this.public_name = null;
		this.public_seq = 0; // todo: should this be a random nonce?
		this.players = {};

		this.key_param = {
			name: "ECDSA",
			namedCurve: "P-384",
			hash: { name: "SHA-256" },
		};

		/*
		 * When the socket connects, attempt to register our key
		 * with the server.
		 */
		this.socket.on('connect', () => this.send_key());
		this.socket.on('players', (player_list) => this.update_players(player_list));
	}

	// generate a signature on the msg, including the sequence number
	// and the public key used to sign it, and send it when it is ready
	// todo: is JSON.stringify() the best way to serialize the message?
	emit(dest, msg)
	{
		let signed_msg = {
			msg: msg,
			seq: this.public_seq++,
			key: this.public_name,
		};

		window.crypto.subtle.sign(
			this.key_param,
			this.private_key,
			getEncoding(JSON.stringify(signed_msg))
		).then((sig) => {
			let sig_hex = array2hex(sig);
			console.log(dest, signed_msg, sig, sig_hex);

			// add the signature to the signed message and send it
			signed_msg.sig = sig_hex;
			this.socket.emit(dest, signed_msg);
		});
	}

	// register a callback for a socket event, with the vai
	on(dest, callback)
	{
		this.socket.on(dest, (msg) =>
			this.validate_message(msg).then((status) => callback(status,msg.msg))
		);
	}

	// check the sequence number and signature for an incoming message
	// to verify that it came from the player that claims to have sent it.
	async validate_message(msg)
	{
		let player = this.players[msg.key];
		let status = {
			valid: false,
			key: false,
			seq: false,
			sig: false,
		};

		// if we do not have a corresponding key for this player,
		// then we can't check the sequence number of signature, so
		// we are done here.
		if (!player)
		{
			console.log("UNKNOWN PLAYER:", msg);
			return status;
		}

		// the key claims to be from a known player
		status.key = msg.key;

		let signed_msg = JSON.stringify({
			msg: msg.msg,
			seq: msg.seq,
			key: msg.key,
		});
		console.log("signed=", signed_msg);

		return window.crypto.subtle.verify(
			this.key_param,
			player.key,
			hex2array(msg.sig),
			getEncoding(signed_msg)
		).then((valid) => {
			// store the 
			status.sig = valid;

			// trust on first use for sequence number,
			// otherwise require an exact match for the expected value
			if (player.seq < 0 || msg.seq == player.seq + 1)
			{
				status.seq = true;
			} else {
				console.log("SEQ MISMATCH", player.seq + 1, msg);
				valid = false;
			}

			if (valid)
			{
				// seq, sig, and key all match
				status.valid = true;
				player.seq = msg.seq;
			} else {
				// something didn't match
				player.cheats++;
			}

			return status;
		});
	}

	// when we reconnect to the server, send our public key
	send_key()
	{
		if (this.public_key)
		{
			console.log("RECONNECTED");
			this.socket.emit('register', public_key);
			return;
		}

		console.log("FIRST CONNECT");
		window.crypto.subtle.generateKey(
			this.key_param,
			true,
			["sign", "verify"]
		).then((k) => {
			console.log("Key created", k);
			this.private_key = k.privateKey;
			return window.crypto.subtle.exportKey('jwk', k.publicKey);
		}).then((jwk) => {
			this.public_key = jwk;
			this.public_name = jwk2id(jwk);
			this.socket.emit('register', jwk);
		});
	}

	// update the list of players
	// todo: if there is a game in
	// action we need to signal an abnormal exit since no new players
	// should join or current players should leave
	// todo: detect a player leaving during game play
	update_players(new_player_list)
	{
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
		for(let id in this.players)
		{
			if (id in new_players)
				continue;

			// todo: cancel a game in progress
			delete players[id];
			//removeElement("player-"+id);
		}

		// add in any new player id's
		for(let id in new_players)
		{
			if (id in this.players)
				continue;

			let player = new_players[id];

			// new player has joined; import their public key
			// todo: add them in observer mode
			this.players[id] = player;
			window.crypto.subtle.importKey(
				'jwk',
				player,
				this.key_param,
				true,
				player.key_ops // [ 'verify' ]
			).then((player_pub) => {
				player.key = player_pub;
			});

/*
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
*/
		}

/*
		// update the total player count
		let counter = document.getElementById('playerCount');
		counter.textContent = Object.keys(players).length;
*/
	}
}

