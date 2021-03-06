/*
 * Utility functions for working with Bigints and random arrays.
 */

(function (exports) {
'use strict'

/*
 * Convert a string or byte array into a BigInt
 */
function array2bigint(bytes)
{
	let hex;

	if (typeof(bytes) == "string")
	{
		hex = bytes
		.split('')
		.map( c => ('00' + c.charCodeAt(0).toString(16)).slice(-2) )
		.join('');
	} else
	if (typeof(bytes) == "object")
	{
		hex = Array.from(bytes)
		.map( c => ('00' + c.toString(16)).slice(-2) )
		.join('');
	} else
	{
		console.log('ERROR', bytes);
	}

	if (hex.length == 0)
	{
		console.log("ERROR: empty hex string?", typeof(bytes), bytes);
		hex = "00";
	}

	let bi = BigInt("0x" + hex);
	//console.log(bytes, bi);
	return bi;
}

/*
 * Convert a BigInt to a binary string
 */
function bigint2string(m,l)
{
	let r = bigint2bytes(m, l);
	return r.map(c => String.fromCharCode(c)).join('');
}

/*
 * Convert a BigInt to a hex string
 */
function bigint2hex(m,l)
{
	let r = bigint2bytes(m, l);
	return r.map(c => ('00' + c.toString(16)).slice(-2) ).join('');
}

/*
 * Convert a BigInt to a byte array of length l in MSB first order.
 */
function bigint2bytes(m,l)
{
	let r = [];

	m = BigInt(m); // just in case

	for(let i = 1 ; i <= l ; i++)
	{
		r[l - i] = Number(m & 0xFFn);
		m >>= 8n;
	}

	if (m != 0n)
		console.log("m too big for l", m, l, r);

	return r;
}


function randomBigint(bits)
{
	let bytes = Math.floor((bits + 7) / 8);
	let a = new Uint8Array(bytes);
	window.crypto.getRandomValues(a);
	let r = array2bigint(a);
	if (r === 0n)
		console.log(a);
	return r;
}

function randomInt(max)
{
	let r = randomBigint(256);
	return Number(r % BigInt(max));
}

function shuffle(deck)
{
	for(let i = deck.length - 1 ; i > 1 ; i--)
	{
		let j = randomInt(i+1);
		let temp = deck[i];
		deck[i] = deck[j];
		deck[j] = temp;
	}

	return deck;
}

function b64decode(s)
{
	// convert the web-safe base64uri encoding to what is accepted
	// by the builtin decoder.
	const b = s.replaceAll("-","+").replaceAll("_","/");
	return window.atob(b);
}


/*
 * Sync compute sha256 of a bigint returning a bigint
 */
function sha256(m,l)
{
	let a = bigint2bytes(m,l);
	let hash = sha256_raw(a);
	return array2bigint(new Uint8Array(hash));
}

exports.array2bigint  =  array2bigint;
exports.bigint2string  =  bigint2string;
exports.bigint2hex  =  bigint2hex;
exports.bigint2bytes  =  bigint2bytes;
exports.randomBigint  =  randomBigint;
exports.randomInt  =  randomInt;
exports.shuffle  =  shuffle;

})(typeof exports === 'undefined' ? this['utils']={} : exports);
