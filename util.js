/*
 * Utility functions for working with Bigints and random arrays.
 */

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
		hex = bytes 
		.map( c => ('00' + c.toString(16)).slice(-2) )
		.join('');
	} else
	{
		console.log('ERROR', bytes);
	}

	let bi = BigInt("0x" + hex);
	//console.log(bytes, bi);
	return bi;
}

/*
 * Convert a BigInt to a binary string
 */
function bigint2array(m)
{
	let r = [];
	while(m)
	{
		let c = Number(m & 0xFFn);
		r.push(String.fromCharCode(c));
		m >>= 8n;
	}

	return r.reverse().join('');
}


function randomBigint(bits)
{
	let bytes = Math.floor((bits + 7) / 8);
	let a = new Uint8Array(bytes);
	window.crypto.getRandomValues(a);
	return array2bigint(a);
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
		console.log("swap", i, j);
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

