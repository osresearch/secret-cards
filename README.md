Secret Cards: Games without a trusted server
===

[Secret.Cards](https://secret.cards) is a way to play card games with any
number of friends (or enemies) without having to trust the other players
or the server.  There is no "trusted dealer" that tracks the cards in
the deck or the hidden cards in players' hands.  As long as there is one
honest player, the cheaters can not influence the order of the cards,
learn the honest player's cards, nor trade cards between themselves.

secret.cards uses a variant of [SRA Encryption](), invented by Shamir, Rivest,
and Adleman in their paper [SRA81]() that described how two players could
play "mental poker" using commutative encryption based on modular exponentiation,
similar to their more well known RSA public-key cryptography.
However, their protocol had many limitations (required revealing all the cards
at the end of the game, deferred cheating detection until after the game was
played, potential known-plaintext attacks, limited to two players, etc).


Protocol
===

Limitations
===

The major limitation is that the players know on which turn the other players received
cards.  This leaks some information about the players' decision making, such as the time
between receiving a card and discarding it.

Players do not learn about each others revealed cards simultaneously.  During a
face-up card deal, the receiving player learns about the card before they reveal
their key to the table, which allows them to abort if the quit penalty is less than
the value at stack.


===

Setup:

```
npm install
node server.js
```

Then load `http://localhost:4423/` from your web browser
