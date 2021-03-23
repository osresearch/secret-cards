"use strict"

// Create a secure channel to communicate with our peers
let channel = new SecureChannel();
let cards = new CardTable(channel);

// Setup the chat box to talk to our peers
let messages = document.getElementById('messages');
let form = document.getElementById('form');
let input = document.getElementById('input');

// the Unicode cards to display
const card_default = "🂠";
const card_faces =
"🂡🂢🂣🂤🂥🂦🂧🂨🂩🂪🂫🂭🂮"+
"🂱🂲🂳🂴🂵🂶🂷🂸🂹🂺🂻🂽🂾"+
"🃁🃂🃃🃄🃅🃆🃇🃈🃉🃊🃋🃍🃎"+
"🃑🃒🃓🃔🃕🃖🃗🃘🃙🃚🃛🃝🃞";
const num_cards = card_faces.length/2; // two-byte characters

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

	let cards = document.createElement('span');
	cards.setAttribute("id", "player-cards-" + peer.id);

	it.appendChild(seq);
	it.appendChild(id_name);
	it.appendChild(cards);

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
		document.getElementById("draw-button").setAttribute("disabled");
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

	if (cards.ready)
		document.getElementById("draw-button").removeAttribute("disabled");
	if (dest === "shuffle")
		document.querySelectorAll(".card").forEach(it => it.remove());	
}


// called when a card is moved
cards.card_move = (card) =>
{
	let old = document.getElementById('card-' + card.index);
	if (old)
		old.remove();

	let it = document.createElement('span');
	it.setAttribute("id", "card-" + card.index);
	it.setAttribute("class", "card");
	it.setAttribute("owner", card.player);
	it.textContent = card_default;

	let player = document.getElementById("player-cards-" + card.player);
	player.appendChild(it);

	return it;
}

// called when a new card is learned
cards.card_value = (card) =>
{
	let it = document.getElementById("card-" + card.index);
	if (!it)
		it = cards.card_move(card);

	let value = Number(card.value);
	let suite = Math.floor(value / 13);

	it.textContent = card_faces.substr(value*2, 2);
	it.setAttribute("value", value);
	it.setAttribute("class", it.getAttribute("class") + ' suite-' + suite);
}
