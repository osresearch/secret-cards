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

		if (is_dealer)
			this.deck = new DeckDealer(deck_size);
		else
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
	 * Receive a command from the other player,
	 * optionally returning a command to send in return.
	 */
	command(m)
	{
		let [cmd,data] = m.split('=');
		if (cmd == 'shuffle')
		{
			if (!this.is_dealer)
				throw "can't shuffle, not the dealer";

			// generate a shuffled deck for export
			return this.export_deck();
		}

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
				player_nonce = BigInt("0x" + nonce);
				card = this.deck.receive({card: encrypted_card, nonce: player_nonce});
			} else {
				// nonce is not required for receiving, but is required for revealing
				card = this.deck.receive(encrypted_card);
				let player_cards = this.deck.deck.filter(c => c.card == card)
				player_nonce = player_cards[0].player_nonce;
			}

			if (options == 'faceup')
				return "reveal=" + card + "," + bigint2hex(player_nonce, 32);

			return;
		}

		if (cmd == 'draw')
		{
			// if there is data, then they want a specific card.
			// otherwise send them any card.
			let card;
			if (data)
			{
				let player_hash = BigInt("0x" + data);
				card = this.deck.drawn(player_hash);
			} else {
				card = this.deck.deal();
			}

			if (this.is_dealer)
				// send just the encrypted card back to them
				return "card=player," + bigint2hex(card, 80);
			else
				return "card=dealer," + bigint2hex(card.card, 80) + "," + bigint2hex(card.nonce, 32);
		}

		if (cmd == 'reveal')
		{
			// they have revealed a card, validate the player nonce
			let [card,player_nonce] = data.split(',');
			player_nonce = BigInt("0x" + player_nonce);
			if (this.deck.validate_card(player_nonce, card))
				console.log("valid card", card);
			return;
		}
	};
}
