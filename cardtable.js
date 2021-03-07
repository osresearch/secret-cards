/*
 * Stuff for dealing and shuffling.
 */
"use strict";
let deck = null;
let final_deck = null;
let final_player = null;
let prev_player = null;
let drawn_card = null;

function shuffle(num_cards=52)
{
	console.log("Starting shuffle operation...");

	// publish a set of proposed cards,
	// and an ordering of the players to
	// complete the shuffle

	let deck = new_deck(); // not encrypted
	let order = utils.shuffle(Object.keys(channel.peers));

	channel.emit('shuffle', {
		deck: deck,
		order: order,
		pass: 0,
	});
}

function draw_random_card(deck)
{
	for(let c of deck)
	{
		if (!c.played)
			return c.name;
	}

	return null;
}

function draw_card(name=null)
{
	if (name == null)
	{
		// find a random card that is not already played
		name = draw_random_card(final_deck);
		if (name == null)
			return;
	}

	// todo: validate that the card we eventually receive is the right one
	drawn_card = name;
	const card_name = utils.bigint2hex(name, 64);

	channel.emit('draw', {
		dest: public_name,
		source: final_player,
		final_name: card_name,
		name: null,
		nonce: null,
	});
}

channel.on('draw', (status,msg) => {
	if (!status.valid)
		return;

	console.log("draw", msg);

	const card = final_deck[msg.name];
	if (!card)
	{
		console.log("UNKNOWN CARD", msg);
		return;
	}

	if (msg.source == final_player)
	{
		// mark the destination as the eventual owner of this card
		// if this is a 
		card.player = msg.dest;
	} else {
		// this is in the chain, so validate the hash and update the deck
		const nonce = BigInt("0x" + msg.nonce);
		const name = BigInt("0x" + msg.name);
		const full_card = nonce << 256n | name;
		const next_name = utils.sha256bigint(full_card, 64);
		if (next_name != card.name)
		{
			console.log("BAD NONCE", msg);
			return;
		}
		card.name = name;
		card.nonces.push(nonce);
	}

	if (msg.source != public_name)
		return;

	if (msg.dest == public_name)
	{
		// this is destined for us
	}

	// todo: ensure that dest is before me in the order
	// this one is for me to decrypt and fill in
	if (msg.dest != public_name)
	{
		const card = deck[msg.name];
		if (!card)
		{
			console.log("UNKNOWN CARD", msg);
			return;
		}

		if (card.played)
		{
			console.log("PLAYED CARD", msg);
			return;
		}

		const nonce = BigInt("0x" + msg.nonce);
		const full_card = nonce << 256n | card.name;
			let name = utils.sha256bigint(full_card, 64); // 2 * 32 bytes for each hash
		channel.emit('draw', {
			dest: msg.msg.dest,
			source: prev_player,
			name: "foo",
		});
	}
});

channel.on('shuffle', (status,msg) => {
	if (!status.valid)
		return;

	console.log("shuffle", msg.pass, status.peer.name);

	// always validate the initial deck
	if (msg.pass == 0 && !new_deck_validate(msg.deck))
		return;

	// once all the passes are over, the final deck is ready
	// todo: validate that the deck only has hashes
	if (msg.pass == msg.order.length)
	{
		final_deck = msg.deck.map(c => {
			return {
				final_name: c.name,
				nonces: [],
				name: null,
				value: null,
				played: false,
			};
		});
		final_player = msg.order[msg.pass - 1];
		console.log("FINAL DECK", status.peer.name, final_deck);
	}

	// if we are not the shuffler for this round, we're done
	if (msg.order[msg.pass] != channel.public_name)
		return;

	// todo: validate that there was an initial pass
	// todo: validate that every pass had a consistent ordering
	// todo: validate that there are no duplicate shufflers
	// todo: validate that there were enough passes for each player
	// todo: validate that the previous player was the source of this message
	// todo: implement cut-n-choose protocol to ensure fairness

	deck = new Deck(msg.deck);
	prev_player = msg.key;

	console.log("my turn to shuffle", deck);

	channel.emit('shuffle', {
		deck: deck.export(),
		order: msg.order,
		pass: msg.pass + 1,
	});
});

class Deck
{
	constructor(prev_deck=null)
	{
		if (prev_deck == null)
			prev_deck = this.new_deck();

		this.sra = sra.SRA();
		this.deck = {};
		for(let c of prev_deck)
		{
			// un-stringify the name and encrypted value
			let prev_name = BigInt("0x" + c.name);
			let encrypted = BigInt("0x" + c.encrypted);

			let nonce = utils.randomBigint(128); // bits
			let full_card = nonce << 256n | prev_name; // new nonce || sha256 of old
			let name = utils.sha256bigint(full_card, 64); // 2 * 32 bytes for each hash

			let card = {
				prev_name: prev_name, // what the previous player called it
				encrypted: encrypted, // encrypted with everyone's key up to me
				nonce: nonce,
				name: name,
			};

			this.deck[name] = card;
		}
	}

	export()
	{
		// extract the public pieces of the deck and export
		// a shuffled version encrypted with our key
		let pub_deck = [];
		for(let name of Object.keys(this.deck))
		{
			let c = this.deck[name];
			let reencrypted = this.sra.encrypt(c.encrypted);
			pub_deck.push({
				name: utils.bigint2hex(c.name, 32),
				encrypted: utils.bigint2hex(reencrypted, 80),
			});
		}

		return utils.shuffle(pub_deck);
	}
}


/*
 * Generate a clean deck, in order, with new nonces.
 */
function new_deck(size=52)
{
	let deck = [];
	for(let i = 0 ; i < size ; i++)
	{
		let nonce = utils.randomBigint(256); // bits
		let full_card = nonce << 256n | BigInt(i);
		let name = utils.sha256bigint(full_card, 64); // 2 * 32 bytes for each hash
		deck.push({
			name: utils.bigint2hex(name,32),
			encrypted: utils.bigint2hex(full_card,64),
		});
	}

	return deck;
}


function new_deck_validate(deck, deck_size=52)
{
	// validate that the cards are proper
	const new_deck_size = deck.length;
	if (new_deck_size != deck_size)
	{
		console.log("incorrect deck size", deck_size);
		return false;
	}

	for(let i = 0 ; i < deck_size ; i++)
	{
		const card = deck[i];
		const value = BigInt("0x" + card.encrypted);
		const name = BigInt("0x" + card.name);
		const mask = (1n << 256n) - 1n;
		if ((value & mask) == BigInt(i))
			continue;
		console.log("card " + i + " invalid value:", card);

		const hash_name = utils.sha256bigint(value, 64); // 2 * 32 bytes for each hash
		if (hash_name == name)
			continue;
		console.log("card " + i + " invalid hash:", card);
		return false;
	}

	console.log("Initial deck validated");
	return true;
}
