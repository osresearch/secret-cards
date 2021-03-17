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

const default_deck_size = 52;

function make_words(x) {
	return x.map(i => words.bigint2words(BigInt(i), 4));
}
function peername(status) { return words.bigint2words(BigInt(status.peer.id)) }

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
	this.next_player = null;
	this.drawn_card = null;

	this.channel.on('shuffle', (status,msg) => this.shuffle_msg(status,msg));
	this.channel.on('draw', (status,msg) => this.draw_msg(status,msg));
	this.channel.on('wrap', (status,msg) => this.wrap_msg(status,msg));
	this.channel.on('unwrap', (status,msg) => this.unwrap_msg(status,msg));
	this.channel.on('unseal', (status,msg) => this.unseal_msg(status,msg));
	this.channel.on('reveal', (status,msg) => this.reveal_msg(status,msg));
}

shuffle(num_cards=default_deck_size)
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
		if (!c.player)
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

	console.log("DRAW INITIAL", card_name);
	this.channel.emit('draw', {
		dest: this.player,
		next: this.final_player,
		final_name: card_name,
		name: card_name,
		nonce: null,
	});
}


reveal(card, dest_name=null)
{
	if (typeof(card) === "bigint")
	{
		let card_hex = utils.bigint2hex(card, 32);
		card = this.final_deck[card_hex];
		if (!card)
		{
			console.log("REVEAL: unknown final card?", card_hex);
			return;
		}
	}

	// make sure we have the card
	if (card.player && card.player != this.player)
	{
		console.log("REVEAL: not our card?", card);
		return;
	}

	// if we're starting at the top to reveal a card,
	// we don't have a previous name for it.
	let prev_name;
	let dest;
	let next;
	let nonces;

	if (dest_name)
	{
		// start at the last player to reveal an unplayed card
		dest = dest_name;
		next = this.final_player;
		prev_name = card.final_name;
		nonces = [];
	} else {
		// start at the next player to reveal a card we've drawn
		dest = this.player;
		next = this.prev_player;
		prev_name = card.our_card.prev_name;
		nonces = card.nonces.map(n => utils.bigint2hex(n, 32));
	}

	this.channel.emit('reveal', {
		dest: dest,
		next: next,
		final_name: utils.bigint2hex(card.final_name, 32),
		name: utils.bigint2hex(prev_name, 32),
		nonces: nonces,
	});
}

reveal_msg(status,msg)
{
	console.log("REVEAL", peername(status), msg.final_name, msg.nonces);

	let card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("REVEAL: bad final name?", msg);
		return;
	}

	// todo: validate that this player has drawn this card?
	// otherwise we'll allow a deal to the table or other string
	if (card.player && msg.dest != card.player)
	{
		console.log("REVEAL: unauthorized reveal?", peername(status), msg);
		return;
	}

	// not all games would require that, for instance turning
	// over the top card on the deck without drawing it.

	// validate the chain of nonces back to the final card
	let name = BigInt(msg.name);

	for(let nonce_string of msg.nonces.slice().reverse())
	{
		let nonce = BigInt(nonce_string);
		let new_name = nonce << 256n | name;
		name = utils.sha256bigint(new_name, 64);
	}

	name = utils.bigint2hex(name, 32);

	if (name != msg.final_name)
	{
		console.log("REVEAL: Bad string of nonces?", name, msg);
		return;
	}

	if (msg.next == null)
	{
		// this is from the very first player, which means that
		// the name should appear in the original deck.  if not
		// then the dealer has cheated.
		let orig_card = this.initial_deck[msg.name];
		if (!orig_card)
		{
			console.log("REVEAL: not in initial deck?", msg);
			return;
		}

		let dest_name = msg.dest;
		if (dest_name.substr(0,2) == "0x")
			dest_name = make_words([msg.dest])[0];

		if (!card.player)
			card.player = msg.dest;

		card.orig_card = orig_card;
		card.value = orig_card.encrypted;
		console.log("VALIDATED", dest_name, card.value);
	}

	if (msg.next != this.player)
		return;

	// we need to reveal our nonce for this name
	let my_card = this.deck.deck[msg.name];
	if (!my_card)
	{
		console.log("REVEAL: not one of my cards?", msg);
		return;
	}

	// todo: validate that the chain of nonces matches our chain
	// that we have recorded from previous announcements.
	//card.nonces = msg.nonces;
	msg.nonces.push(utils.bigint2hex(my_card.nonce, 32));

	this.channel.emit('reveal', {
		dest: msg.dest,
		next: this.prev_player,
		final_name: msg.final_name,
		name: utils.bigint2hex(my_card.prev_name, 32),
		nonces: msg.nonces,
	});
}

hands()
{
	let hands = {};
	for(let hash in this.final_deck)
	{
		let card = this.final_deck[hash];
		let player = card.player;
		if (!player)
			player = "deck";

		if (!(player in hands))
			hands[player] = [];

		hands[player].push(card); //.value == null ? null : card.value);
	}

	return hands;
}


/*
 * Receive a card with the final value.
 * Make sure it was in the initial deck and not a duplicate, etc
 */
receive_card(card, value)
{
	const card_hash = utils.sha256bigint(value, 64);
	const card_name = utils.bigint2hex(card_hash, 32);

	if (!(card_name in this.initial_deck))
	{
		console.log("BAD CARD", card, value, card_name);
		return;
	}

	card.orig_card = this.initial_deck[card_name];
	card.value = value & 0xFFFFFFFFFFFFFFFFn;

	console.log("DEALT TO ME:", card.value);
}


/*
 * Draw messages flow from last to first player.
 */
draw_msg(status,msg)
{
	if (!status.valid)
		return;

	//console.log("DRAW", make_words(msg.dest), msg.final_name);

	const card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("DRAW: UNKNOWN CARD", msg);
		return;
	}

	if (msg.next == this.final_player)
	{
		// mark the destination as the eventual owner of this card
		// if this is the first message for this card.  someone might
		// be cheating if this is an attempt to draw the card again.
		if (card.player)
		{
			console.log("DRAW: CARD ALREADY PLAYED", msg);
			return;
		}

		console.log("DRAW:", make_words([msg.dest])[0], msg.final_name);
		card.player = msg.dest;
		card.known_name = BigInt(msg.final_name);
	} else
	if (!card.known_name)
	{
		console.log("DRAW: protocol error: no nonces known", card);
		return;
	} else {
		// this is in the chain, so validate the hash and update the deck
		const nonce = BigInt(msg.nonce);
		const name = BigInt(msg.name);
		const full_card = nonce << 256n | name;
		const next_name = utils.sha256bigint(full_card, 64);
		if (next_name != card.known_name)
		{
			console.log("DRAW: BAD NONCE", next_name, card.known_name, card, msg);
			return;
		}
		card.known_name = name;
		card.nonces.push(nonce);
		console.log("DRAW: nonces", msg.final_name, card.nonces);
	}

	if (msg.next != this.player)
	{
		// nothing else for us to do with this one until
		// they ask us for it.
		return;
	}

	// if this is a card for us, then we switch to the phase2 of the draw protocol
	if (msg.dest == this.player)
		return this.draw_phase2(msg, card);

	// todo: ensure that dest is before me in the order
	// this one is for me to decrypt and fill in
	const my_card = this.deck.deck[msg.name];
	//console.log("my card", my_card);
	if (!my_card)
	{
		console.log("DRAW: UNKNOWN CARD", msg);
		return;
	}

	const prev_name = utils.bigint2hex(my_card.prev_name, 32);
	const my_nonce = utils.bigint2hex(my_card.nonce, 32);

	console.log("DRAW: ", msg.final_name, my_nonce);

	this.channel.emit('draw', {
		dest: msg.dest,
		next: this.prev_player,
		final_name: msg.final_name,
		name: prev_name,
		nonce: my_nonce,
	});
}

/*
 * Phase two is to wrap the encrypted card and flows towards the first player
 */
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
	card.nonces.push(card.our_card.nonce);

	if (!this.prev_player)
	{
		// special case: if we're the first player, then we do not need
		// to do anything.  it is OURS!
		return this.receive_card(card, card.our_card.encrypted);
	}

	console.log("WRAP INITIAL", card_name);

	// generate a temporary key and encrypt the card with it
	if (card.temp_key)
		console.log("OVERLAPPING DEALS!");

	card.temp_key = sra.SRA();

	// wrap the encrypted card with both our original key and the temporary key
	let reencrypted = card.temp_key.encrypt(this.deck.sra.encrypt(card.our_card.encrypted));

	this.channel.emit('wrap', {
		dest: msg.dest,
		next: this.prev_player,
		final_name: msg.final_name,
		encrypted: utils.bigint2hex(reencrypted, 80),
	});
}

/*
 * TODO: validate that we're wrapping for the right player
 * TODO: validate the wrapped messages once the keys are revealed
 *
 * wrap continues phase 2 flowing towards first player
 */
wrap_msg(status,msg)
{
	if (!status.valid)
		return;

	console.log("WRAP", peername(status), msg.final_name);

	const card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("WRAP: UNKNOWN CARD", msg);
		return;
	}

	// just store the wrapped message
	if (status.peer.id in card.wrapped)
	{
		console.log("WRAP: peer sent multiple wraps?", peername(status), msg);
		return;
	}

	let encrypted = BigInt(msg.encrypted);
	card.wrapped[status.peer.id] = encrypted;

	if (msg.next != this.player)
		return;

	// generate a temporary key and encrypt the card with it as a wrapper
	if (card.temp_key)
		console.log("WRAP: OVERLAPPING DEALS!", msg);

	card.temp_key = sra.SRA();

	let reencrypted = card.temp_key.encrypt(encrypted);

	this.channel.emit('wrap', {
		dest: msg.dest,
		next: this.prev_player,
		final_name: msg.final_name,
		encrypted: utils.bigint2hex(reencrypted, 80),
	});

	if (this.prev_player)
		return;

	// special case if we're the first player
	// start the unwrapping process
	console.log("UNWRAP INITIAL", msg.final_name);
	let unwrapped = this.deck.sra.decrypt(reencrypted);

	this.channel.emit('unwrap', {
		dest: msg.dest,
		next: this.next_player,
		final_name: msg.final_name,
		encrypted: utils.bigint2hex(unwrapped, 80),
	});
}

/*
 * TODO: validate that we're wrapping for the right player
 * TODO: validate the wrapped messages once the keys are revealed
 * TODO: only process unseal messages if we are sure we have all of them
 *
 * Unwraps flow outwards from first player to last player
 */
unwrap_msg(status,msg)
{
	if (!status.valid)
		return;

	console.log("UNWRAP", peername(status), msg.final_name);

	const card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("UNWRAP: UNKNOWN CARD", msg);
		return;
	}

	if (!(status.peer.id in card.wrapped))
	{
		console.log("UNWRAP: Peer didn't send intial message?", peername(status), msg);
		return;
	}

	// store the latest version of the unlocked message
	let encrypted = BigInt(msg.encrypted);
	card.encrypted = encrypted;

	if (msg.next != this.player)
		return;

	// if we haven't created a temp key, then something is wrong in the
	// protocol or someone is cheating.
	if (!card.temp_key)
	{
		console.log("UNWRAP: No temp key?", card);
		return;
	}

	// decrypt with our permanent key.
	// if we're an intermediate we sent this on.
	// if we're the destination for the card, then we do not share it.
	let decrypted = this.deck.sra.decrypt(encrypted);

	if (msg.dest != this.player)
	{
		// we're an intermediate player in the wrapping process
		// continue the flow outwards by removing our original key
		// (which leaves our temporary key in place)

		if (!this.next_player)
		{
			console.log("UNWRAP: protocol error? final player not the destination?", msg);
			return;
		}

		console.log("UNWRAP", msg.final_name);

		this.channel.emit('unwrap', {
			dest: msg.dest,
			next: this.next_player,
			final_name: msg.final_name,
			encrypted: utils.bigint2hex(decrypted, 80),
		});
	} else {
		// if we're the final destination for this wrapped card,
		// then we now have our card, encrypted with all of the temp keys.
		// we can decrypt with our original key, leaving only the temp keys.
		card.unwrapped = decrypted;

		// start by revealing our temp key, which asks everyone else
		// to reveal their temp keys to finish the unsealing process.
		console.log("UNSEAL INITIAL", msg.final_name);
		this.channel.emit('unseal', {
			dest: msg.dest,
			next: this.prev_player,
			final_name: msg.final_name,
			key: utils.bigint2hex(card.temp_key.d, 80),
		});
	}
}

/*
 * TODO: validate that we're wrapping for the right player
 * TODO: validate the wrapped messages once the keys are revealed
 * TODO: only process unseal messages if we are sure we have all of them
 */
unseal_msg(status,msg)
{
	if (!status.valid)
		return;

	console.log("UNSEAL", peername(status), msg.final_name);

	const card = this.final_deck[msg.final_name];
	if (!card)
	{
		console.log("UNSEAL: UNKNOWN CARD", msg);
		return;
	}

	if (!(status.peer.id in card.wrapped))
	{
		console.log("UNSEAL: peer did not wrap card", msg, card);
		return;
	}

	// validate that the wrapped version decrypts with this key
	// so that they did not launch a blind-signing attack
	let d = BigInt(msg.key);
/*
	console.log("unsealing", card);
	let m1 = BigInt(card.wrapped[status.peer.id]);

	if (sra.modExp(m1, d, this.deck.sra.p) != m2)
	{
		console.log("UNSEAL: peer used wrong unwrapping key", peername(status), card, msg);
		return;
	}
*/

	// if this is the first unsealing key we've received,
	// update the unwrapped value with the last encrypted one we received.
	if (card.unwrapped == null)
		card.unwrapped = card.encrypted;

	card.unwrapped = sra.modExp(card.unwrapped, d, this.deck.sra.p);
	let hex = utils.bigint2hex(card.unwrapped, 80);

	// this was the final value, so the card should be good
	if (msg.next == null && msg.dest == this.player)
	{
		this.receive_card(card, card.unwrapped);
		return;
	}

	//console.log("Partial unseal: ", hex);

	if (msg.next != this.player)
		return;

	if (!card.temp_key)
	{
		console.log("UNSEAL: protocol error? no temp key for card", msg, card);
		return;
	}
	
	this.channel.emit('unseal', {
		final_name: msg.final_name,
		dest: msg.dest,
		key: utils.bigint2hex(card.temp_key.d, 80),
		next: this.prev_player,
	});
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
				final_name: BigInt(c.name),
				nonces: [],
				name: null,
				value: null,
				player: null,
				wrapped: {},
				encrypted: null,
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

	if (msg.pass != 0)
		this.prev_player = status.peer.id;
	else
		this.prev_player = null;

	if (msg.pass < msg.order.length)
		this.next_player = msg.order[msg.pass+1];
	else
		this.next_player = null;

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
			let prev_name = BigInt(c.name);
			let encrypted = BigInt(c.encrypted);

			let nonce = utils.randomBigint(256); // bits
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
function new_deck(size=default_deck_size)
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


function new_deck_validate(deck, deck_size=default_deck_size)
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
		const value = BigInt(card.encrypted);
		const name = BigInt(card.name);
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
