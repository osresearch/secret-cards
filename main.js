"use strict"

// Create a secure channel to communicate with our peers
let channel = new SecureChannel();

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
		item.textContent = '❌ ' + msg + " " + status;
	} else {
		item.textContent = '✓ ' + msg;
	}

	messages.appendChild(item);
	window.scrollTo(0, document.body.scrollHeight);
});

function peer_update(id)
{
	document.getElementById("peer-sequence-"+id).textContent = peers[id].seq;
}
