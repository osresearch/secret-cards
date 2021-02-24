/*
 * Wrap the raw DeckDealer and DeckPlayer objects with more complex
 * operations that use web-safe base64 encoding.
 */
class CardTable
{
	constructor(deck_size,is_dealer)
	{
		this.is_dealer = is_dealer;
		this.deck_size = deck_size;
		this.deck = null;
	}

	/*
	 * Output the deck in a format for the other side to import.
	 */
	export_deck()
	{
		let deck = this.deck.export()
			.map(c => bigint2hex(c.encrypted,80) + "|" + bigint2hex(c.hash,32))
			.join(',');
		return "deck=" + deck;
	}

	/*
	 * When we're connected or restarting, generate a deck and send it over
	 */
	shuffle()
	{
		// player waits for the dealer, so do nothing
		if (!this.is_dealer)
			return;

		// create a new deck
		this.deck = new DeckDealer(this.deck_size);

		// shuffle and encrypt the deck for export
		return this.export_deck();
	}

	/*
	 * Reveal a card from our hand
	 */
	reveal(card)
	{
		if (!card || card.card == undefined)
			return;

		card.revealed = true;
		console.log("reveal", card);
		let nonce = this.is_dealer ? card.dealer_nonce : card.player_nonce;

		return "reveal=" + bigint2hex(card.card, 32) + "," + bigint2hex(nonce, 32);
	}

	/*
	 * Discard a card from our hand
	 * (or the deck, or the other player's hand, although there might be game rules about that)
	 */
	discard(card)
	{
		if (!card)
			return;

		card.played = 'discard';
		return "discard=" + bigint2hex(card.player_hash, 32);
	}

	/*
	 * Receive a command from the other player,
	 * optionally returning a command to send in return.
	 */
	command(m)
	{
		let [cmd,data] = m.split('=');

		if (cmd == 'deck')
		{
			let deck = data.split(',').map(c => {
				let [enc,hash] = c.split('|');
				enc = BigInt("0x" + enc);
				hash = BigInt("0x" + hash);
				return {
					encrypted: enc,
					hash: hash,
				}
			});

			if (this.is_dealer)
			{
				// player has returned an encrypted deck to us,
				// import it and we are ready to play.
				this.deck.import(deck);
				return;
			} else {
				// dealer has sent us the deck, setup our player deck to
				// re-encrypt it and return the new deck to them
				this.deck = new DeckPlayer(deck);
				return this.export_deck();
			}
		}

		if (cmd == 'card')
		{
			// Receive a card from the other side.
			// if this is a "face up" card, reveal the value
			let card = false;
			let [options,encrypted_card,player_nonce] = data.split(',');
			if (encrypted_card)
				encrypted_card = BigInt("0x" + encrypted_card);

			if (this.is_dealer)
			{
				// must have a nonce!
				if (!player_nonce)
					throw "dealer must receive nonce"
				player_nonce = BigInt("0x" + player_nonce);
				card = this.deck.receive({card: encrypted_card, nonce: player_nonce});
			} else {
				// nonce is not required for receiving, but is required for revealing
				card = this.deck.receive(encrypted_card);
				//let player_cards = this.deck.deck.filter(c => c.card == card)
				//player_nonce = player_cards[0].player_nonce;
			}

			if (options == 'faceup')
				return this.reveal(card);

			return;
		}

		if (cmd == 'draw')
		{
			// if there is data, then they want a specific card.
			// otherwise send them any card.
			let card;
			let target = 'facedown';

			if (data == 'faceup')
			{
				target='faceup';
				data = false;
			}

			if (data)
			{
				let player_hash = BigInt("0x" + data);
				card = this.deck.drawn(player_hash);
			} else {
				card = this.deck.deal();
			}

			if (this.is_dealer)
			{
				// send just the encrypted card back to them
				return "card=" + target + "," + bigint2hex(card, 80);
			} else {
				// send the card with the encryption, plus our nonce to validate it
				return "card=" + target + "," + bigint2hex(card.card, 80) + "," + bigint2hex(card.nonce, 32);
			}
		}

		if (cmd == 'reveal')
		{
			// they have revealed a card, validate the player nonce
			let [card,player_nonce] = data.split(',');
			player_nonce = BigInt("0x" + player_nonce);
			card = BigInt("0x" + card);
			if (this.deck.validate_card(player_nonce, card))
				console.log("valid card", card);
			return;
		}

		if (cmd == 'discard')
		{
			// they are discarding a card from their hand; only the player nonce is required
			const player_hash = BigInt("0x" + data);
			const cards = this.deck.deck.filter(c => c.player_hash == player_hash);
			if (cards.length != 1)
				throw "bad card", player_hash;
			const card = cards[0];

			// todo: validate that they had the card to discard?
			card.played = 'discard';

			return;
		}
	};
}
