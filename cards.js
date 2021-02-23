/*
 * Mental Poker using Extended SRA.
 *
 * Cards a 128 bits of dealer nonce and 128 bits of card ID (256 bits == 32 bytes)
 * Dealer commits are sha256 hashes of 64 bytes of card data (MSB first)
 * Player commits are 128 bit player nonce and 256 bits of dealer sha256 hash (MSB first)
 */

class DeckDealer
{
	constructor(size)
	{
		this.deck = [];
		this.hand = [];
		this.sra = new SRA();

		for(let i = 0 ; i < size ; i++)
		{
			let nonce = randomBigint(128); // bits
			let full_card = nonce << 128n | BigInt(i);

			let card = {
				card: BigInt(i),
				dealer_nonce: nonce,
				dealer_encrypted: this.sra.encrypt(full_card),
				dealer_hash: sha256(full_card, 64), // bytes
			};

			this.deck[i] = card;
		}

		shuffle(this.deck);
	}

	/*
	 * Output the shuffled deck for export to a player.
	 * Player learns:
	 *  - the set of cards encrypted with the dealer's key
	 *  - the hashes of all of the cards
	 */
	export()
	{
		return this.deck.map(function(card) { return {
			encrypted: card.dealer_encrypted,
			hash: card.dealer_hash,
		}});
	}

	/*
	 * Import a deck from the player, decrypting with our key, leaving only the player's key in place.
	 * There is nothing to merge yet, since we do not have a mapping of our nonces to theirs.
	 * We don't have to shuffle it, but we do anyway.
	 */
	import(player_deck)
	{
		if (player_deck.length != this.deck.length)
			throw "length mismatch";

		// should verify uniqueness of each player commitment hash

		let sra = this.sra;

		this.player_deck = player_deck.map( function (player_card) { return {
			played: false,
			player_hash: player_card.hash,
			player_encrypted: sra.decrypt(player_card.encrypted), // now only B
		}});

		shuffle(this.player_deck);
	}

	/*
	 * Deal a card to the player.  Returns the card encrypted with only the player's key.
	 */
	deal()
	{
		for(let card of this.player_deck)
		{
			if (card.played)
				continue;
			card.played = true;
			return card.player_encrypted;
		}

		// no cards left!
		return null;
	}

	/*
	 * Receive a card from the player, which requires both an encrypted card and the player's nonce.
	 */
	receive(encrypted_card, player_nonce)
	{
		let decrypted_card = this.sra.decrypt(encrypted_card);
		let dealer_nonce = decrypted_card >> 128n;
		let card = decrypted_card & 0xFFFFFFFFFFFFFFFFn;

		console.log("dealer received card", card, bigint2hex(dealer_nonce, 16));

		// verify that this card matches this nonce in the dealer deck
		let dealer_card = this.deck.filter(c => c.card == card && c.dealer_nonce == dealer_nonce);
		if (dealer_card.length != 1)
			throw "fake card! (dealer_nonce not found)";

		// compute the player's commitment hash
		let player_hash = sha256(player_nonce << 256n | dealer_card[0].dealer_hash, 64);
		console.log("player_hash", player_hash, dealer_card[0]);
		let player_card = this.player_deck.filter(c => c.player_hash == player_hash);
		if (player_card.length != 1)
			throw "fake nonce! (player_nonce not found)";
		console.log(player_card);

		player_card[0].played = 1;
		this.hand.push({
			card: card,
			dealer_nonce: dealer_nonce,
			player_nonce: player_nonce,
		});
	}
};


/*
 * The player deck receives a set of cards encrypted with the dealer's key,
 * and the commitment hashes for each card.
 */
class DeckPlayer
{
	constructor(dealer_deck)
	{
		this.deck = [];
		this.hand = [];
		this.sra = new SRA();

		this.deck = dealer_deck.map(dealer_card => {
			// generate a per-card nonce that can be revealed when
			// committing to dealing a card back to the dealer.
			let player_nonce = randomBigint(128);

			return {
				dealer_hash: dealer_card.hash,
				dealer_encrypted: dealer_card.encrypted, // only dealer's encryption
				player_nonce: player_nonce,
				player_hash: sha256(player_nonce << 256n | dealer_card.hash, 64),
			};
		});

		shuffle(this.deck);
	}

	/*
	 * Output the shuffled, re-encrypted deck, for export back to the dealer.
	 * The dealer learns:
	 *  - the player's commitment hashes for each card
	 *  - the player's encrypted version of the dealer's encrypted card
	 */
	export()
	{
		let sra = this.sra;
		return this.deck.map(function(card) { return {
			encrypted: sra.encrypt(card.dealer_encrypted), // now both A and B
			hash: card.player_hash,
		}});
	}

	/*
	 * Receive a card from the dealer, which is encrypted with only the player's key
	 */
	receive(encrypted_card)
	{
		// decrypt it so that we know the real card, which includes both the card id
		// and the dealer's nonce for this card.
		let decrypted = this.sra.decrypt(encrypted_card);
		let dealer_nonce = decrypted >> 128n;
		let card = decrypted & 0xFFFFFFFFFFFFFFFFn;

		// find the hash in the dealer's commitment list to mark as played
		let dealer_hash = sha256(decrypted, 64);
		console.log("player received", bigint2hex(decrypted, 32), bigint2hex(dealer_hash, 32));

		for(let player_card of this.deck)
		{
			if (player_card.dealer_hash != dealer_hash)
				continue;
			if (player_card.played)
				throw "already played!";

			player_card.played = true;

			this.hand.push({
				card: card,
				dealer_nonce: dealer_nonce,
				player_nonce: player_card.nonce,
			});

			return true;
		}

		throw "card not in deck!";
	}

	/*
	 * Deal a card to the dealer.  Returns the card encrypted with only the dealer's key
	 * and the player's nonce for this card.
	 */
	deal()
	{
		for(let card of this.deck)
		{
			if (card.played)
				continue;
			card.played = true;
			
			console.log("player sends to dealer:", card);
			return [ card.dealer_encrypted, card.player_nonce ]; // only A's encryption, player's nonce
		}

		// no cards left!
		return null;
	}
}


let d;
let p;


function setup()
{
	d = new DeckDealer(16);
	p = new DeckPlayer(d.export());
	d.import(p.export());
}
