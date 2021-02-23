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
			card.played = 'player';
			return card.player_encrypted;
		}

		// no cards left!
		return null;
	}

	/*
	 * Receive a card from the player, which requires both an encrypted card and the player's nonce.
	 */
	receive(player_message)
	{
		if (!player_message)
			return null;

		const encrypted_card = player_message.card;
		const player_nonce = player_message.nonce;
		const decrypted_card = this.sra.decrypt(encrypted_card);
		const dealer_nonce = decrypted_card >> 128n;
		const card = decrypted_card & 0xFFFFFFFFFFFFFFFFn;

		// verify that this card matches this nonce in the dealer deck
		const dealer_card = this.deck.filter(c => c.card == card && c.dealer_nonce == dealer_nonce);
		if (dealer_card.length != 1)
			throw card + " fake card! (dealer_nonce not found)";

		// compute the player's commitment hash
		const player_hash = sha256(player_nonce << 256n | dealer_card[0].dealer_hash, 64);

		// find the player's commitment hash in the deck they sent
		const player_card = this.player_deck.filter(c => c.player_hash == player_hash);
		if (player_card.length != 1)
			throw card + " fake nonce! (player_nonce not found)";

		if (player_card[0].played)
			throw card + " card already played!";

		// this is a valid unplayed card,
		// with a valid commitment hash from dealer and player
		player_card[0].played = 'dealer';

		this.hand.push({
			card: card,
			dealer_nonce: dealer_nonce,
			player_nonce: player_nonce,
		});

		console.log(this.hand.map(c => c.card));
		return card;
	}

	/*
	 * When the player reveals a card, validate that it is a good one.
	 */
	validate_card(player_nonce, card)
	{
		// look for this face value in our original deck
		const dealer_cards = this.deck.filter(c => c.card == card);
		if (dealer_cards.length != 1)
			throw "card not in original deck";
		const dealer_card = dealer_cards[0];

		// compute the player hash for this card based on the nonce
		const player_hash = sha256(player_nonce << 256n | dealer_card.dealer_hash, 64);

		// find the player's commitment hash in the deck they sent
		const player_cards = this.player_deck.filter(c => c.player_hash == player_hash);

		if (player_cards.length == 0)
			throw "card not found"; // return null;
		if (player_cards.length > 1)
			throw "duplicate hashes found"; // return null;

		const player_card = player_cards[0];

		if (player_hash != player_card.player_hash)
			throw "invalid nonce or hash"; // return null;

		// they claim that they have received player_card and that it
		// has the face value of card.
		if (player_card.played != 'player')
			throw "not dealt to player"; // return null;

		// they were dealt this card, the player nonce matches the commited value
		// update our information about this card
		player_card.card = card;

		return player_card;
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
		const sra = this.sra;
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
		if (!encrypted_card)
			return null;

		// decrypt it so that we know the real card, which includes both the card id
		// and the dealer's nonce for this card.
		const decrypted = this.sra.decrypt(encrypted_card);
		const dealer_nonce = decrypted >> 128n;
		const card = decrypted & 0xFFFFFFFFFFFFFFFFn;

		// find the hash in the dealer's commitment list to mark as played
		const dealer_hash = sha256(decrypted, 64);
		//console.log("player received", bigint2hex(decrypted, 32), bigint2hex(dealer_hash, 32));

		const player_cards = this.deck.filter(c => c.dealer_hash == dealer_hash);
		if (player_cards.length != 1)
			throw card + " card not in dealer deck!";

		const player_card = player_cards[0];

		if (player_card.played)
			throw card + " card already played!";

		player_card.played = 'player';

		this.hand.push({
			card: card,
			dealer_nonce: dealer_nonce,
			player_nonce: player_card.player_nonce,
		});

		console.log("player hand", this.hand.map(c => c.card));

		return card;
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

			card.played = 'dealer';
			
			//console.log("player sends to dealer:", card);

			return {
				card: card.dealer_encrypted, // only dealer can decrypt
				nonce: card.player_nonce
			};
		}

		// no cards left!
		return null;
	}

	/*
	 * Validate a card revealed by the dealer.
	 */
	validate_card(dealer_nonce, card)
	{
		// compute the dealer hash for this card
		const full_card = dealer_nonce << 128n | card;
		const dealer_hash = sha256(full_card, 64);

		const dealer_cards = this.deck.filter(c => c.dealer_hash == dealer_hash);
		if (dealer_cards.length != 1)
			throw "invalid card";

		const dealer_card = dealer_cards[0];
		if (dealer_card.played != "dealer")
			throw "not dealt to dealer";

		return dealer_card;
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
