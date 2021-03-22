"use strict"

// Create a secure channel to communicate with our peers
let channel = new SecureChannel();
let cards = new CardTable(channel);

// Setup the chat box to talk to our peers
let messages = document.getElementById('messages');
let form = document.getElementById('form');
let input = document.getElementById('input');

form.addEventListener('submit', (e) => {
	e.preventDefault();
	if (!input.value)
		return;

	channel.emit('chat', input.value);
	input.value = '';
});

function removeElement(id)
{
	let it = document.getElementById(id);
	if (it)
		it.remove();
}

// when a peer sends a chat message, the secure channel
// wil validate the signature.  we display it either way,
// with an error if the peer is unknown, out of sequence or bad signature
channel.on('chat', (status,msg) => {
	var item = document.createElement('li');
	if (!status.valid)
	{
		item.textContent = '❌ ' + peer.name + ": " + msg + " " + status;
	} else {
		item.textContent = '✓ ' + peer.name + ": " + msg;
	}

	messages.appendChild(item);
	window.scrollTo(0, document.body.scrollHeight);
});

channel.peer_new = (peer) =>
{
	let peer_list = document.getElementById('peers');
	if (!peer_list)
		return;

	let it = document.createElement('li');
	it.setAttribute("id", "peer-" + peer.id);

	let seq = document.createElement('span');
	seq.setAttribute("class", "peer-sequence");
	seq.setAttribute("id", "peer-sequence-" + peer.id);
	seq.textContent = '-- ';

	let id_name = document.createElement('span');
	id_name.textContent = peer.name;
	if (peer.id == channel.public_name)
		id_name.setAttribute("class", "player-name");
	else
		id_name.setAttribute("class", "peer-name");


	it.appendChild(seq);
	it.appendChild(id_name);
	peer_list.appendChild(it);

	let peers = document.getElementById('peer-count');
	peers.textContent = Object.keys(channel.peers).length;
}

channel.peer_remove = (peer) =>
{
	let it = document.getElementById("peer-" + peer.id);
	if (it)
		it.remove();

	if (cards.ready)
	{
		console.log("GAME OVER! Player disconnected", peer.name);
		cards.ready = false;
	}

	document.getElementById('peer-count').textContent = channel.peers.length;
}

channel.update = (dest,status,msg) =>
{
	// update the sequence number for this peer
	// as well as flag any cheating attempts
	let seq = document.getElementById("peer-sequence-" + status.peer.id);
	if (!seq)
		return;

	if (!status.valid)
		seq.setAttribute("cheater", true);

	seq.textContent = msg.seq + ' ';
}
