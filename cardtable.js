/*
 * Stuff for dealing and shuffling.
 *
 * To shuffle:
 * A player proposes an ordering of the other players and a set of cards.
 *
 * The first player in the ordering generates an SRA key and encrypts each card
 * with this key.  They shuffle the deck and publish the encrypted, shuffled result.
 *
 * Each player in turn does the same until the deck has been shuffled by every player,
 * and every player's SRA key has been applied.  This is the final deck ordering.
 *
 * The first player generates an SRA key per card in the final deck ordering,
 * decrypts each card with their initial SRA key and re-encrypts each card with
 * its unique the new SRA keys.  They publish the hash of the decryption exponent
 * for each key, along with the re-encrypted card.
 *
 * Each player in turn does the same until every player has removed their initial
 * per-deck SRA keys and re-applied their per-card SRA keys, as well as published
 * the hashes of each of these keys.
 *
 *
 * To draw a card:
 * A player selects an unplayed card in the final deck ordering and asks
 * for it by index in that ordering.
 * Every other player publishes their per-card SRA decryption exponent.
 * Every player can validate that the other player's exponents match
 * the commitment hash.
 * The player drawing the card can apply all of the decryption exponents,
 * resulting in learning the value of the card.
 *
 * If the card is not in the initial set, then someone cheated during the
 * shuffle stage.  To prevent this a cut-n-choose protocol is necessary to
 * ensure that no player has tried to fake the shuffle encryption.  The
 * drawing player can prove that someone cheated by publishing their per-card
 * SRA key (although it is not known who is cheating).
 *
 *
 * To reveal a card:
 * The player publishes their per-card SRA key and the index value in the final
 * ordering.  Since all of the other players have seen the other per-card SRA keys,
 * they can apply the decryption and verify the value of the card.
 *
 * A player can't publish a fake card since they would need a pre-commitment hash
 * for a decryption key that would work once all of the others had been applied.
 */
"use strict";

const default_deck_size = 52;

function make_words(x) {
	return x.map(i => words.bigint2words(BigInt(i), 4));
}
function peername(status) { return words.bigint2words(BigInt(status.peer.id)) }

function sha256hex(s)
{
	//const b = s.split('').map(c => String.fromCharCode(c));
	return sha256.sha256hex(s.split(''));
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
	this.encrypted_deck = null;
	this.commitments = {};

	this.channel.on('shuffle', (status,msg) => this.shuffle_msg(status,msg));
	this.channel.on('unseal', (status,msg) => this.unseal_msg(status,msg));
	//this.channel.on('lock', (status,msg) => this.lock_msg(status,msg));
	//this.channel.on('draw', (status,msg) => this.draw_msg(status,msg));
	//this.channel.on('unlock', (status,msg) => this.unlock_msg(status,msg));
	//this.channel.on('reveal', (status,msg) => this.reveal_msg(status,msg));
}

shuffle(num_cards=default_deck_size)
{
	// publish a set of proposed cards,
	// and an ordering of the players to
	// complete the shuffle
	// todo: validate that the initial deck we get back is the one we sent
	const initial_deck = new_deck(); // not encrypted, everyone validates it
	this.order = Object.keys(this.channel.peers);
	utils.shuffle(this.order)

	// hack to set our name
	this.player = this.channel.public_name;

	console.log("Starting shuffle operation...", make_words(this.order));

	this.channel.emit('shuffle', {
		pass: 0,
		order: this.order,
		deck: initial_deck,
	});
}

shuffle_msg(status, msg)
{
	console.log("SHUFFLE", status.peer.name);
	if (msg.pass == 0)
	{
		// this is the initial, unencrypted deck
		if (!validate_deck(msg.deck))
		{
			console.log("bad deck?");
			return;
		}

		// hack to set our name
		this.player = this.channel.public_name;
	
		// store the deck of cleartext cards
		this.cards = msg.deck;

		// reset our player commitments for the final order
		for(let player of msg.order)
			this.commitments[player] = [];
	}

//console.log(this.player, msg.order, msg.pass);
	if (msg.order[msg.pass] != this.player)
		return;

	// it is our turn to shuffle!
	utils.shuffle(msg.deck);

	// we're the last player, so switch to a per-card SRA and start
	// the unsealing process
	if (msg.pass == msg.order.length - 1)
	{
		msg.pass++;
		return this.unseal_msg(status, msg);
	}

	// if we're not the last player, encrypt with a per-deck SRA
	// and output the shuffled deck.
	this.sra = sra.SRA();

	this.channel.emit('shuffle', {
		pass: msg.pass + 1,
		order: msg.order,
		deck: msg.deck.map(c => this.sra.encrypt(c)),
	});
}


unseal_msg(status, msg)
{
	if (msg.pass < msg.order.length)
	{
		console.log("UNSEAL", status.peer.name, msg);

		const player = status.peer.id;

		if (msg.order[msg.pass] != player)
		{
			console.log("WRONG PLAYER", status.peer.id, msg);
			return;
		}

		// store everyone else's commitments
		if (player != this.player)
			this.commitments[player] = msg.hashes;
	}

	if (msg.pass == 0)
	{
		// everyone has shuffled, unsealed, and commited to
		// their hashes.  store the final deck, which is now
		// encrypted only with everyone's per-card SRA keys.
		this.ready = 1;
		this.deck = msg.deck;
		return;
	}

	if (msg.order[msg.pass-1] != this.player)
		return;

	// my turn to unseal and commit to this shuffle
	// (in the same order as the final ordering)
	let new_deck = [];
	let hashes = [];
	this.keys = [];
	
	for(let card of msg.deck)
	{
		let s = sra.SRA();
		let hash = sha256hex(s.d.toString(16));

		new_deck.push(s.encrypt(card));
		hashes.push(hash);
		this.keys.push(s.d);
	}

	this.channel.emit('unseal', {
		pass: msg.pass - 1,
		order: msg.order,
		hashes: hashes,
		deck: new_deck,
	});
}



}



/*
 * Generate a clean deck, in order, with new nonces.
 */
function new_deck(size=default_deck_size)
{
	let deck = [];
	for(let i = 0 ; i < size ; i++)
	{
		let nonce = utils.randomBigint(256); // bits
		let card = nonce << 256n | BigInt(i);
		let card_hex = card.toString(16);

		deck.push(card_hex);
	}

	return deck;
}


function validate_deck(deck, deck_size=default_deck_size)
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
		const value = BigInt("0x" + card);
		const mask = (1n << 256n) - 1n;
		const card_value = value & mask;

		if (card_value != BigInt(i))
		{
			console.log("card " + i + " invalid value:", card);
			return false;
		}

	}

	//console.log("Initial deck validated", deck);
	console.log("Initial deck validated");
	return true;
}
