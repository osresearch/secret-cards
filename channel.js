/*
 * Secure channel communications between the peers.
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
		this.peers = {};

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
		this.socket.on('peers', (peer_list) => this.update_peers(peer_list));
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
			//console.log(dest, signed_msg, sig, sig_hex);

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
	// to verify that it came from the peer that claims to have sent it.
	async validate_message(msg)
	{
		let peer = this.peers[msg.key];
		let status = {
			valid: false,
			peer: null,
			seq: false,
			sig: false,
		};

		// if we do not have a corresponding key for this peer,
		// then we can't check the sequence number of signature, so
		// we are done here.
		if (!peer)
		{
			console.log("UNKNOWN PEER:", msg);
			return status;
		}

		// the key claims to be from a known peer
		// we can't trust the server to fill in a peer,
		// so we use the hash of the public key.
		status.peer = peer;

		let signed_msg = JSON.stringify({
			msg: msg.msg,
			seq: msg.seq,
			key: msg.key,
		});
		//console.log("signed=", signed_msg);

		return window.crypto.subtle.verify(
			this.key_param,
			peer.key,
			hex2array(msg.sig),
			getEncoding(signed_msg)
		).then((valid) => {
			// store the 
			status.sig = valid;

			// trust on first use for sequence number,
			// otherwise require an exact match for the expected value
			if (peer.seq < 0 || msg.seq == peer.seq + 1)
			{
				status.seq = true;
			} else {
				console.log("SEQ MISMATCH", peer.seq + 1, msg);
				valid = false;
			}

			if (valid)
			{
				// seq, sig, and key all match
				status.valid = true;
				peer.seq = msg.seq;
			} else {
				// something didn't match
				peer.cheats++;
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
			this.socket.emit('register', this.public_key);
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

	// update the list of peers
	// todo: if there is a game in
	// action we need to signal an abnormal exit since no new peers
	// should join or current peers should leave
	// todo: detect a peer leaving during game play
	update_peers(new_peer_list)
	{
		let peer_list = document.getElementById('peers');
		console.log(new_peer_list);

		let new_peers = {};
		for(let new_peer of new_peer_list)
		{
			// don't trust the server's hash; do it ourselves
			let id = jwk2id(new_peer);
			new_peer.id = id;
			new_peer.name = words.bigint2words("0x" + id);
			new_peer.seq = -1;
			new_peer.cheats = 0;
			new_peers[id] = new_peer;
		}

		// check to see if any peer id's have gone away
		for(let id in this.peers)
		{
			if (id in new_peers)
				continue;

			// todo: cancel a game in progress
			delete peers[id];
			//removeElement("peer-"+id);
		}

		// add in any new peer id's
		for(let id in new_peers)
		{
			if (id in this.peers)
				continue;

			let peer = new_peers[id];

			// new peer has joined; import their public key
			// todo: add them in observer mode
			this.peers[id] = peer;
			window.crypto.subtle.importKey(
				'jwk',
				peer,
				this.key_param,
				true,
				peer.key_ops // [ 'verify' ]
			).then((peer_pub) => {
				peer.key = peer_pub;
			});

/*
			// add them to the peer list
			let it = document.createElement('li');
			it.setAttribute("id", "peer-" + id);

			let seq = document.createElement('span');
			seq.setAttribute("class", "peer-sequence");
			seq.setAttribute("id", "peer-sequence-" + id);
			seq.textContent = '--';
			let id_name = document.createElement('span');
			id_name.setAttribute("class", "peer-name");
			id_name.textContent = id;

			it.appendChild(seq);
			it.appendChild(id_name);
			peer_list.appendChild(it);
*/
		}

		console.log("PEERS:", Object.values(this.peers).map(p => p.name));

/*
		// update the total peer count
		let counter = document.getElementById('peerCount');
		counter.textContent = Object.keys(peers).length;
*/
	}
}

