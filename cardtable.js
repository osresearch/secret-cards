/*
 * Stuff for dealing and shuffling.
 */
"use strict";
let deck = null;
let final_deck = null;

function shuffle(num_cards=52)
{
	console.log("Starting shuffle operation...");

	// publish a set of proposed cards,
	// and an ordering of the players to
	// complete the shuffle

	let deck = new_deck(); // not encrypted
	let order = utils.shuffle(Object.keys(players));

	send_signed('shuffle', {
		deck: deck,
		order: order,
		pass: 0,
	});
}

socket.on('shuffle', (msg) => recv_signed(msg).then((valid) => {
	const shuffle = msg.msg;
	if (!valid)
		return;

	console.log("shuffle", msg);

	// always validate the initial deck
	if (shuffle.pass == 0 && !new_deck_validate(shuffle.deck))
		return;

	// once all the passes are over, the final deck is ready
	if (shuffle.pass == shuffle.order.length)
	{
		final_deck = shuffle.deck;
		console.log("FINAL DECK", final_deck);
	}

	// if we are not the shuffler for this round, we're done
	if (shuffle.order[shuffle.pass] != public_name)
		return;

	// todo: validate that there was an initial pass
	// todo: validate that every pass had a consistent ordering
	// todo: validate that there are no duplicate shufflers
	// todo: validate that there were enough passes for each player
	// todo: validate that the previous player was the source of this message
	// todo: implement cut-n-choose protocol to ensure fairness

	deck = new Deck(msg.key, shuffle.deck);

	send_signed('shuffle', {
		deck: deck.export(),
		order: shuffle.order,
		pass: shuffle.pass + 1,
	});
}));

class Deck
{
	constructor(prev_player=null, prev_deck=null)
	{
		if (prev_player == null && prev_deck == null)
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
				prev_player: prev_player,
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
