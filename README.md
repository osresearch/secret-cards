Extended SRA
===

Goals of the original SRA81 paper:

* Neither player can influence the order of the cards

* Neither player can known what is in the other player's hand

* After the game the players can prove the cards in their hands

* After the game the players can prove that the deck was complete

The drawback of the last steps is that the each player learns the
contents of the others' hand since the full deck ordering is revealed.
This is problematic for poker, since when a player folds only the visible
cards are known and players have no obligation to reveal the remaining cards.
Discarded cards are never revealed to the other players.

Additionally, during play there are a few additional steps: it is
desirable for the players to be able to recognize if the cards are the
legitimate cards ones or if the player is cheating by claiming to reveal
a different card.

When a player discards a card, they must not be able to reuse the
card later, but the other player should not learn anything about the
discarded card.

Lastly, when a card is revealed by either player, it is important for the
other player to know that the card is one that has actually been dealt.

Extended SRA allows players to really play poker with these extensions.

There are newer papers and algorithms that add these desired features,
such as described in "A Toolbox for Mental Card Games", although these
are significantly more complicated than Extended SRA.

Operations
===

The primitive operations are:

* Shuffle all the cards
* Dealer chooses a face-down card to give to the Player (Player learns value, Dealer does not)
* Player chooses a face-down card to give to the Dealer (Dealer learns value, Player does not)
* Dealer asks the Player for a face-down card
* Player asks the Dealer for a face-down card
* Dealer or Player reveals a card that they know (other party can verify the card is legitimate and its tags)
* Dealer or Player tag a card as being in the Dealer or Player hands, Discarded, on the Table, in the Deck, etc

From these primitives more complex operations can be constructed, such as
_Dealer plays a face-up card on the Table from the Deck_:
* Dealer chooses a face-down card to give to the Player, who learns the value
* Player verifies that the card is valid and tagged as in the Deck
* Player reveals the card's value to the Dealer
* Dealer verifies that the revealed card is the previously face-down card
* Player and Dealer tag the card as on the Table


Setup
===

Two players, Alice and Bob, agree on the number of cards and the contents
that they should contain. In this example they will be the four-byte integers
0-51.

SRA
---
They also agree on a base prime $p$, such as the fifteenth Mersenne prime,
$2^1279 - 1$, that will be used for the modulus.

Both players generate a random secret value $K$ that is relatively prime to the
modulus - 1, as well compute the modular inverse $K'$ of their secret values.
These are $K_a$, $K'_a$, $K_b$ and $K'_b$.  They keep these values secret
and will use them in the usual SRA method for encrypting and decrypting cards:

$$c_a = E(K_a, m) = m^{K_a} % p$$
$$m= D(K_a, c_a) = {c_a}^{K'_a} % p = m^{K_a K'_a} % p = m$$

Since they agree on the modulus $p$, this has the commutative property that:

$$c = E(K_a, E(K_b, m)) = E(K_b, E(K_a, m))$$

and also that decryption can be applied in either order:

$$c = E(K_a, E(K_b, m)) = E(K_b, E(K_a, m))$$
$$m = D(K_b, D(K_a, c)) = D(K_a, D(K_b, c))$$

Intuitively, $K_a$ and $K_b$ are like two locks that can be added and removed
in either order.  This property gives rise to a simple "Draw a Card" mechanic by
which two parties can exchange a single message from a set, without revealing
the entire set.

Alice can encrypt messages with $K_a$ and send them to Bob,
who can shuffle them and encrypt with $K_b$, then send this reordering back to
Alice.  She can now decrypt all of them with $K'_a$, but does not learn of
Bob's shuffling. She can select a message at random to send to Bob, who can
decrypt it with $K'_b$ and learn that one message, but none of the others.

Unlike the original SRA Mental Poker, they never publish $K_a$ and $K_b$,
so the other player is not able to learn what cards had been dealt.


Shuffling
---

Alice generate a random nonce $n_i$ for each card $m_i$, computes
$c_i = E(K_a, n_i || m_i)$ for each card as well as the cryptographically
secure hash $H(n_i || m_i)$ to commit to the values of the cards.
She shuffles both the encrypted and hashed values with ordering $S_1$
and sends this to Bob.

Since Bob wants to be sure that the deck is complete, they perform
a cut-and-choose style proof.  Alice sends N versions of the deck
with different $K_a$ and nonces $n_i$. Bob selects N-1 of them to
be unblinded so Alice reveals her key $K'_a$ for those decks and Bob
is able to decrypt them and verifies that all of them were complete.
He now has faith with probability $1-2^{-n}$ that Alice is not cheating
and that the last deck is complete.

Bob creates a per-card nonce $n'_i$ and adds another set of commitment hashes
$H(n'_i || H(n_i || c_i))$ to the surving deck.

He then shuffles the deck and both Alice and his commitment hashes with $S_2$
encrypts each of the cards with his key:

$$E(K_b, c_i) = E(K_b, E(K_a, n_i || m_i))$$

He sends this re-order and additionally encrypted deck back to Alice
along with his commitment hashes (but not Alice's commitment hashes,
since he does not want to reveal the ordering $S_2$ to Alice).
Bob does not know the original ordering of the cards, nor is he able
to deduce their values from the hashes since the function $H()$ is
computationally infeasible to reverse.

Alice applies her decryption operation to the deck that has been reordered
by Bob, which removes her encryption and leaves only Bob's:

$$D(K_a, E(K_b, c_i)) == D(K_a, E(K_b, E(K_a, n_i||m_i))) = E(K_b, n_i||m_i)$$

The key observation from the original SRA paper is that Alice does not know
the ordering of the cards, so she does not know which of Bob's commitment
hashes correspond to which cards.


Dealing
---
The dealing process is slightly asymetic due to the different pieces that Alice and Bob have.
Each party knows how many cards have been played. Alice can choose to go through the
deck in order for dealing, or she can select randomly from it.

Alice deals a card to Bob:
* Alice selects an unused card $j$ from the deck and sends it to Bob: $E(K_b, n_j || c_j)$
* She does not know what it contains, since it is encrypted with Bob's key $K_b$.
* She does know that Bob committed to this card with $H(n'_j || H(n_j || c_j))$
* Bob decrypts the card $n_j || c_j = D(K_b, E(K_b, n_j || c_j))$
* He verifies that $H(n_j || c_j)$$ is on the original card list and not yet dealt to either player
* Alice knows which commitment hash goes with this card, but
* Alice does not know which card Bob has received since she does not know the mapping $S2$
* since Bob's commitment hash does not reveal anything about the card

Bob deals a card to Alice:
* Bob selects an unused card $j$ from the deck and sends Alice's version of it plus his nonce to her: $E(K_a, n_j||c_j)$ and $n'_j$.
* Alice decrypts the card with $K'_a$: $n_j || c_j = D(K_a, E(K_a, n_j||c_j))$
* Alice knows that she has received a valid card since the nonce $n_j$ matches her list
* Alice computes Bob's commitment hash $H(n'_j || H(n_j||c_j)$ and verifies that it is in the list.
* Alice marks this card as dealt.
* Alice doesn't learn anything about Bob's shuffle, other than this one index mapping.
* Bob does not learn which card Alice has received since the cards are encrypted with Alice's key
* Alice knows that she has received a valid commitment since the hash $H(n'_j || H(n_j||c_j))$ matches Bob's commitment on this card
* Bob can't send a fake card since he doesn't know Alice's nonce $n_j$
* Bob can't send a fake commitment nonce $n'_j$ since he doesn't know the card contents

Alice draws a card:
* Alice chooses an unplayed card and send Bob his commitment hash on it,
* Bob replies with the Alice-only encrypted version and his nonce for that card,
* Since he knows the mapping of his commitment hashes to her versions)

Bob draws a card:
* Bob chooses an unplayed card and send Alice his commitment hash;
* She replies with the Bob-only encrypted version
* She doesn't learn anything about the card

Note that there is a race condition for these operations; the player and dealer
must not mix the dealing and drawing, or else they could end up selecting the
same card and dealing it to each other.

Revealing cards
---

When Alice "turns card $c_i$ over" to reveal it, she publishes $n_i$
* Bob can validate that $H(n_i || c_i)$ is in the original card commitments, so this is a legitimate card,
* Alice can try to cheat since she knows the full set of $n_i||c_i$, except that Bob knows that Alice
only holds the cards that she has committed to, so he can detect the attempt to pull out a hole card.
* Bob can verify with is nonce $n'_i$ that this card was dealt to Alice (and when, unfortunately), but this does not reveal any additional cards in Alice's hand.
* Alice can't play fake a card since $H(n_i || c_i)$ must appear in the initial card list and she
must have committed to the hash during a dealing phase.
* Until Alice reveals $n_i$, however, Bob is unable to know what that commitment represented.

For Bob to reveal a card $c_i$, he publishes his nonce $n'_i$ as well as the Alice's nonce $n_i' that he learned
when the card was dealt to him.
* Alice is able to validate that $n_i$ is the correct nonce for $c_i$ since she generated it
* Alice computes the hash $H(n'_i || H(n_i || c_i))$ and both matches Bob's expected commitment for the card,
as well as ensures that it was one that Bob was dealt.
* Bob can't generate a fake card since he does not know the nonces, while Alice knows the $n_i || c_i$ for every valid card.
* Alice learns when Bob received this card, but since $n'_i$ is unique to
that card, Alice does not learn any information about other cards to which Bob has committed.

If the card must be revealed immediately following the deal, the other player is able to
verify that this is the new card that had just been dealt since either Bob knows Alice's
commitment hash $H(n_i||c_i)$ for the dealt card, or Alice knows Bob's commitmentent hash
$H(n'_i||H(n_i||c_i))$ for the most recently dealt card.


Discarding cards
---

Alice or Bob can declare that any of their commitments have been discarded, which
prevents them from using them later when they reveal some of their cards.
They also can't change which cards they have announced as discarded since:
* Bob knows that Alice's discarded commitments are valid since they match the ones in the original list
(even though he does not know which cards they represent).
* Alice knows that Bob's discarded commitments are valid since they match the ones in the shuffled
list that he returned (even though she does not know which cards they represent)


Limitations
===

The major limitation is that the players know on which turn the other players received
cards.  This leaks some information about the players' decision making, such as the time
between receiving a card and discarding it.

An outside observer does not have anyway to validate that the game is being played fairly.
No key material is ever exposed, so a transcript does not prove anything.

Players do not learn about each others revealed cards simultaneously.  There is no
atomic "reveal" operation at the end of a hand, for instance.

Cards dealt face up require the assistance of both players -- one to
choose the card and one to reveal it.  The revealing player learns
the new card value first and can abort the protocol or spoil the game
without revealing the contents if it is unfavorable.

Extensibility to more than two parties is a work in progress.
Desired multiplayer features:

* Complete decks are still guaranteed with high probability
* Fair dealing is preserved even if N-1 players are colluding
* Collusion only shares information about colluding players' hands
* No card passing between players due to commitments

===

Setup:

```
npm install
node server.js
```

Then load `http://localhost:4423/` from your web browser
