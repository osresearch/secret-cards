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

function make_words(x) {
	return x.map(i => words.bigint2words(BigInt("0x" + i), 4));
}

/*
 * TODO: Cut-n-choose shuffle protocol
 * TODO: Detect game ending events (players going away)
 * TODO: Lots of validation.
 */
class CardTable
{
constructor(channel)
{
	this.channel = channel;
	this.player = this.channel.public_name; // who am i?
	this.players = []; // will be fixed when the shuffle happens
	this.deck = null;
	this.final_deck = null;
	this.final_player = null;
	this.prev_player = null;
	this.drawn_card = null;

	this.channel.on('shuffle', (status,msg) => this.shuffle_msg(status,msg));
	this.channel.on('draw', (status,msg) => this.draw_msg(status,msg));
	this.channel.on('wrap', (status,msg) => this.wrap_msg(status,msg));
}

shuffle(num_cards=8)
{
	// publish a set of proposed cards,
	// and an ordering of the players to
	// complete the shuffle
	// todo: validate that the initial deck we get back is the one we sent
	this.initial_deck = new_deck(); // not encrypted, everyone validates it
	this.order = Object.keys(this.channel.peers);
	utils.shuffle(this.order)

	console.log("Starting shuffle operation...", make_words(this.order));

	this.channel.emit('shuffle', {
		deck: Object.values(this.initial_deck),
		order: this.order,
		pass: 0,
	});
}

draw_random_card(deck)
{
	for(let i in deck)
	{
		let c = deck[i];
		if (!c.played)
			return c.final_name;
	}

	return null;
}

draw_card(name=null)
{
	if (name == null)
	{
		// find a random card that is not already played
		name = this.draw_random_card(this.final_deck);
		if (name == null)
		{
			console.log("EMPTY DECK?");
			return;
		}
	}

	// todo: validate that the card we eventually receive is the right one
	this.drawn_card = name;
	const card_name = utils.bigint2hex(name, 32);

	console.log("DRAWING", name);
	this.channel.emit('draw', {
		dest: this.player,
		source: this.final_player,
		final_name: card_name,
		name: card_name,
		nonce: null,
	});
}

draw_msg(status,msg)
{
	if (!status.valid)
		return;

	console.log("draw", msg);

	const card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("UNKNOWN CARD", msg);
		return;
	}

	if (msg.source == this.final_player)
	{
		// mark the destination as the eventual owner of this card
		// if this is the first message for this card.  someone might
		// be cheating if this is an attempt to draw the card again.
		if (card.player)
			console.log("CARD ALREADY PLAYED", msg);
		console.log("Dealing to ", make_words([msg.dest]));
		card.player = msg.dest;
		card.known_name = BigInt("0x" + msg.final_name);
	} else
	if (!card.known_name)
	{
		console.log("deal out of order? no nonces known", card);
		return;
	} else {
		// this is in the chain, so validate the hash and update the deck
		const nonce = BigInt("0x" + msg.nonce);
		const name = BigInt("0x" + msg.name);
		const full_card = nonce << 256n | name;
		const next_name = utils.sha256bigint(full_card, 64);
		if (next_name != card.known_name)
		{
			console.log("BAD NONCE", next_name, card.known_name, card, msg);
			return;
		}
		card.known_name = name;
		card.nonces.push(nonce);
		console.log("card", msg.final_name, card.nonces);
	}

	if (msg.source != this.player)
	{
		// nothing else for us to do with this one until
		// they ask us for it.
		return;
	}

	if (msg.dest == this.player)
		return this.draw_phase2(msg, card);

	// todo: ensure that dest is before me in the order
	// this one is for me to decrypt and fill in
	const my_card = this.deck.deck[msg.name];
	console.log("my card", my_card);
	if (!my_card)
	{
		console.log("UNKNOWN CARD", msg);
		return;
	}

	if (my_card.played)
	{
		console.log("PLAYED CARD", msg);
		return;
	}

	console.log("passing on nonce", my_card);
	this.channel.emit('draw', {
		dest: msg.dest,
		final_name: msg.final_name,
		name: utils.bigint2hex(my_card.prev_name, 32),
		nonce: utils.bigint2hex(my_card.nonce, 16),
		source: this.prev_player,
	});
}

draw_phase2(msg,card)
{
	// this is destined for us, switch to phase 2 of the draw

	// we should be able to identify it in our deck
	let card_name = utils.bigint2hex(card.known_name, 32);
	if (!(card_name in this.deck.deck))
	{
		console.log("card not in our deck?", card_name, card);
		return;
	}

	card.our_card = this.deck.deck[card_name];

	if (!this.prev_player)
	{
		// special case: if we're the first player, then we do not need
		// to do anything.  it is OURS!
		let orig_name = utils.bigint2hex(card.our_card.prev_name, 32);
		card.orig_card = this.initial_deck[orig_name];
		card.nonces.push(card.our_card.nonce);
		console.log("FOR US!", orig_name, card);
		return;
	}

	console.log("Wrapping", card);

	// generate a temporary key and encrypt the card with it
	if (card.temp_key)
		console.log("OVERLAPPING DEALS!");
	card.temp_key = sra.SRA();

	let reencrypted = card.temp_key.encrypt(card.known_name);
	this.channel.emit('wrap', {
		dest: msg.dest,
		final_name: msg.final_name,
		source: this.prev_player,
		encrypted: utils.bigint2hex(reencrypted, 80),
	});
}

wrap_msg(status,msg)
{
	console.log("WRAP", msg);
}

/*
 * TODO: validate that we are not in a game!
 */
shuffle_msg(status,msg)
{
	// hack to update our name now that we have one
	this.player = this.channel.public_name; // who am i?

	if (!status.valid)
		return;

	console.log("shuffle", msg.pass, make_words(msg.order));

	// always validate the initial deck
	if (msg.pass == 0)
		this.initial_deck = new_deck_validate(msg.deck);
	if (!this.initial_deck)
	{
		console.log("No valid initial deck!");
		return;
	}

	// once all the passes are over, the final deck is ready
	// todo: validate that the deck only has hashes
	if (msg.pass == msg.order.length)
	{
		this.final_deck = {};
		for(let c of msg.deck)
		{
			if (c.name in this.final_deck)
				console.log("DUPLICATE CARD!", c);

			this.final_deck[c.name] = {
				final_name: BigInt("0x" + c.name),
				nonces: [],
				name: null,
				value: null,
				played: false,
			};
		}

		this.final_player = msg.order[msg.pass - 1];
		console.log("FINAL DECK", status.peer.name, this.final_deck);
	}

	// if we are not the shuffler for this round, we're done
	if (msg.order[msg.pass] != this.player)
		return;

	// todo: validate that there was an initial pass
	// todo: validate that every pass had a consistent ordering
	// todo: validate that there are no duplicate shufflers
	// todo: validate that there were enough passes for each player
	// todo: validate that the previous player was the source of this message
	// todo: implement cut-n-choose protocol to ensure fairness

	this.deck = new Deck(msg.deck);
	this.players = msg.order;

	if (msg.pass == 0)
		this.prev_player = null;
	else
		this.prev_player = status.peer.id;

	console.log("my turn to shuffle", this.deck);

	this.channel.emit('shuffle', {
		deck: this.deck.export(),
		order: msg.order,
		pass: msg.pass + 1,
	});
}
}

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

			this.deck[utils.bigint2hex(name, 32)] = card;
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
function new_deck(size=8)
{
	let deck = {}
	for(let i = 0 ; i < size ; i++)
	{
		let nonce = utils.randomBigint(256); // bits
		let full_card = nonce << 256n | BigInt(i);
		let name = utils.sha256bigint(full_card, 64); // 2 * 32 bytes for each hash
		let hex_name = utils.bigint2hex(name, 32);

		deck[hex_name] = {
			name: hex_name,
			encrypted: utils.bigint2hex(full_card,64),
		};
	}

	return deck;
}


function new_deck_validate(deck, deck_size=8)
{
	// validate that the cards are proper
	const new_deck_size = deck.length;
	if (new_deck_size != deck_size)
	{
		console.log("incorrect deck size", deck_size);
		return false;
	}

	let new_deck = {};

	for(let i = 0 ; i < deck_size ; i++)
	{
		const card = deck[i];
		const value = BigInt("0x" + card.encrypted);
		const name = BigInt("0x" + card.name);
		const mask = (1n << 256n) - 1n;
		const card_value = value & mask;
		const hash_name = utils.sha256bigint(value, 64); // 2 * 32 bytes for each hash

		if (card_value != BigInt(i))
		{
			console.log("card " + i + " invalid value:", card);
			return;
		}

		if (hash_name != name)
		{
			console.log("card " + i + " invalid hash:", card);
			return;
		}

		new_deck[card.name] = deck[i];
	}

	console.log("Initial deck validated", new_deck);
	return new_deck;
}
