/*
 * Stuff for dealing and shuffling.
 *
 * We have to keep a deck per player, and an ordering of the players.
 *
 * To shuffle, we need to generate N*M+1 decks, where N is the number of players
 * and M is the probability of detecting a cheater. After the shuffling rounds,
 * each player chooses M decks to discard. All of the players reveal their SRA
 * keys for those decks, which can then be checked for validity.  This leaves one
 * encrypted deck that has probability 1/2^-M of being invalid, assuming that
 * all but one of the players is honest.
 *
 * When we draw a card, it comes from the last player in the ordering.
 * They have to reveal their name nonce, which reveals the previous player's name,
 * and the next player reveals theirs, etc until it reaches us and we have the card
 * encrypted with all of the previous players keys.
 *
 * Then we generate an ephemeral key and encrypt the card with this temporary key,
 * and publish the card.  The previous player generates a key, encrypts the card,
 * etc until it reachers the first player.  Who also geneates a key, but both
 * encrypts the card with it as well as decrypts it with their real key.
 * Then the first player decrypts with their real key, etc until it reaches
 * us.  We now have the card encrypted with all of the temporary keys plus
 * our real key.  Everyone reveals their temporary keys, and can validate that
 * no one tried a blind-signing attack.  We can decrypt with our real key and
 * learn which card we've received.
 *
 * To reveal the card, we publish our name nonce for it as well as the prior nonces
 * that end up at the final name.  The previous player
 * does the same, etc all the way to the first player.  If the chain of hashes
 * matches the final name, then we prove that we received that card.
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
		dest: channel.public_name,
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

	if (msg.source != channel.public_name)
		return;

	if (msg.dest == channel.public_name)
	{
		// this is destined for us
	}

	// todo: ensure that dest is before me in the order
	// this one is for me to decrypt and fill in
	if (msg.dest != channel.public_name)
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
