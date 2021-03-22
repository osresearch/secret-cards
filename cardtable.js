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
	this.channel.on('encrypt', (status,msg) => this.encrypt_msg(status,msg));
	this.channel.on('draw', (status,msg) => this.draw_msg(status,msg));
	this.channel.on('decrypt', (status,msg) => this.decrypt_msg(status,msg));
}

shuffle(num_cards=default_deck_size)
{
	// publish a set of proposed cards,
	// and an ordering of the players to
	// complete the shuffle
	// todo: validate that the initial deck we get back is the one we sent
	const initial_deck = new_deck(num_cards); // not encrypted, everyone validates it
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
	if (msg.pass == 0)
	{
		console.log("NEW DECK", status.peer.name, msg.deck.length);

		// this is the initial, unencrypted deck
		if (!validate_deck(msg.deck, msg.deck.length))
		{
			console.log("bad deck?");
			return;
		}

		// hack to set our name
		this.player = this.channel.public_name;
	
		// store the deck of clear cards
		this.ready = false;
		this.cards = msg.deck;
		this.deck_size = msg.deck.length;

		// setup our encrypted deck bookkeeping
		// final shuffled order and hash commitments will
		// arrive in later messages
		this.deck = [];
		for(let i = 0 ; i < this.deck_size ; i++)
		{
			this.deck[i] = {
				index: i,
				value: null,
				sra: sra.SRA(),
				player: null,
				hashes: {},
				encrypted: null,
				encrypts: 0,
			};
		}

	} else {
		console.log("SHUFFLE", status.peer.name);
		if (msg.deck.length != this.deck_size)
		{
			console.log("BAD DECK SIZE", status.peer.name, msg);
			return;
		}
	}

//console.log(this.player, msg.order, msg.pass);
	// if all the players have shuffled and every card is now encrypted
	// with their per-deck key.  start the unsealing process.
	if (msg.pass == msg.order.length)
	{
		if (msg.order[0] == this.player)
			return this.encrypt_msg(status, {
				pass: 0,
				order: msg.order,
				deck: msg.deck,
			});
		return;
	}

	if (msg.order[msg.pass] != this.player)
		return;

	// it is our turn to shuffle!
	utils.shuffle(msg.deck);


	// if we're not the last player, encrypt with a per-deck SRA
	// and output the shuffled deck.
	this.sra = sra.SRA();

	this.channel.emit('shuffle', {
		pass: msg.pass + 1,
		order: msg.order,
		deck: msg.deck.map(c => this.sra.encrypt(c)),
	});
}


encrypt_msg(status, msg)
{
	if (msg.pass != 0)
	{
		if (msg.deck.length != this.deck_size || msg.hashes.length != this.deck_size)
		{
			console.log("BAD DECK SIZE", status.peer.name, msg);
			return;
		}

		console.log("UNSEAL", status.peer.name, msg);

		const player = status.peer.id;

		if (msg.order[msg.pass-1] != player)
		{
			console.log("WRONG PLAYER", status.peer.id, msg);
			return;
		}

		// store everyone's commitments in the deck order
		for(let i = 0 ; i < msg.hashes.length ; i++)
		{
			let card = this.deck[i];
			card.hashes[player] = msg.hashes[i];
			card.encrypts++;
		}
	}

	if (msg.pass == msg.order.length)
	{
		// everyone has shuffled, unsealed, and commited to
		// their hashes.  store the final deck, which is now
		// encrypted only with everyone's per-card SRA keys.
		// todo: verify that everyone has had both passes
		// todo: cut-n-choose protocol
		this.ready = 1;

		for(let i = 0 ; i < msg.deck.length ; i++)
		{
			let card = this.deck[i];
			card.encrypted = msg.deck[i];
			card.player = null;
		}

		console.log("SHUFFLE COMPLETE", this.deck);
		return;
	}

	if (msg.order[msg.pass] != this.player)
		return;

	// my turn to decrypt each card with my per-deck key,
	// re-encrypt each card with my per-card key,
	// and commit to the per-card key.
	// (in the same order as the final ordering)
	let new_deck = [];
	let hashes = [];
	
	for(let i = 0 ; i < this.deck_size ; i++)
	{
		let card = this.deck[i];
		let hash = sha256hex(card.sra.d.toString(16));

		card.hashes[this.player] = hash;
		hashes[i] = hash;
		new_deck[i] = card.sra.encrypt(this.sra.decrypt(msg.deck[i]));
	}

	this.channel.emit('encrypt', {
		pass: msg.pass + 1,
		order: msg.order,
		hashes: hashes,
		deck: new_deck,
	});
}

draw_card(index=null)
{
	if (!this.ready)
	{
		console.log("not ready to deal!");
		return;
	}

	let card;
	if (index === null)
	{
		for(let i = 0 ; i < this.deck_size ; i++)
		{
			if (this.deck[i].player != null)
				continue;
			index = i;
			card = this.deck[i];
			break;
		}
	} else {
		card = this.deck[i];
	}

	if (!card)
	{
		console.log("NO MORE CARDS!");
		return;
	}

	if (card.player)
		console.log("attempting to play an already drawn card", card);

	card.player = this.player;

	// remove our own encryption key
	card.encrypted = card.sra.decrypt(card.encrypted);
	card.encrypts--;

	this.channel.emit('draw', {
		index: index,
	});
}

draw_msg(status,msg)
{
	console.log("DRAW", status.peer.name, msg.index);

	// ignore draw messages from ourselves (so that we don't reveal our key)
	if (status.peer.id == this.player)
		return;

	let card = this.deck[msg.index];
	if (card.player)
	{
		console.log("already drawn!", card);
		return;
	}

	// assign this card to the other player
	card.player = status.peer.id;

	// and reveal our per-card key for this one
	this.channel.emit('decrypt', {
		index: msg.index,
		key: card.sra.d.toString(16),
	});
}

decrypt_msg(status,msg)
{
	console.log("DECRYPT", status.peer.name, msg.index);
	let card = this.deck[msg.index];

	// validate that the hash matches the one from this peer
	let hash = sha256hex(msg.key);
	if (hash != card.hashes[status.peer.id])
	{
		console.log("BAD HASH", status.peer.name, hash, card);
		return;
	}

	// apply this other player's key to the encrypted value
	card.encrypted = sra.modExp(card.encrypted, msg.key, card.sra.p);

	// remove it from the hash to avoid double decryption
	card.hashes[status.peer.id] = "USED";

	if (--card.encrypts > 0)
		return;

	// final version of the card is ours!
	// todo: verify that this exists in the initial deck
	console.log("CARD", card);
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
