"use strict"

let channel = new SecureChannel();

function removeElement(id)
{
	let it = document.getElementById(id);
	if (it)
		it.remove();
}

channel.on('chat', (status,msg) => {
	// setup the chat box
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
});

// attempt to validate the signature on the message
// todo: check sequence number, match to existing player
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

function player_update(id)
{
	document.getElementById("player-sequence-"+id).textContent = players[id].seq;
}
