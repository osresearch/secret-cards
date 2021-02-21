/*
 * Compute a^e % n with big integers
 * using the modular exponentiation so that it can be done
 * in (non-constant) log2 time.
 */
function modExp(a, e, n)
{
	let r = 1n;
	let x = a % n;

	while (e != 0n)
	{
		if (e % 2n)
			r = (r * x) % n;

		e /= 2n;
		x = (x * x) % n;
	}

	return r;
}


/*
 * Compute the extended Euler Greatest Common Denominator (GCD)
 * of two BigInt values.
 * Returns g, x, y such that a*x + b*y = g == gcd(a,b)
 */
function egcd(a,b)
{
	let x = 0n;
	let y = 1n;
	let u = 1n;
	let v = 0n;

	while (a !== 0n)
	{
		const q = b / a;
		const r = b % a;
		const m = x - (u * q);
		const n = y - (v * q);
		b = a;
		a = r;
		x = u;
		y = v;
		u = m;
		v = n;
	}

	return { g: b, x: x, y: y };
}

// default prime is the 15th Mersenne prime, which has 1279 bits and
// which serves as a nothing up-my-sleeves number to provide similar
// security to RSA2048.
const default_prime = 2n ** 1279n - 1n;

/*
 * Create an SRA encryption key for a given prime
 */
function sra_key(p=0n)
{
	if (p === 0n)
		p = default_prime;

	let phi_p = p - 1n;
	let dec_digits = (""+ phi_p).length;
	let num_bytes = dec_digits / 2;
	let bytes = new Uint8Array(num_bytes);
	
	while(true)
	{
		// choose a random encryption key and check to see if it
		// is relatively prime to the modulus.
		window.crypto.getRandomValues(bytes);
		let k = BigInt("0x" + bytes
			.map( c => ('00' + c.toString(16)).slice(-2) )
			.join(''));
		console.log("trying", k);

		// gcd(k,phi_p) == 1 means that they are relatively prime
		let g = egcd(k, phi_p);
		if (g.g != 1n)
			continue;

		// ensure modular inverse is also positive
		let inv = g.x;
		if (inv < 0)
			inv = inv + phi_p;

		return {
			k: k,
			e: inv,
			p: p,
		};
	} 
}



/*
 * Generates an RSA key pair with the WebCrypto API
 */
function _rsaKey()
{
	return window.crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048, //can be 1024, 2048, or 4096
			publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
			hash: {name: "SHA-256"}, //can be "SHA-1", "SHA-256", "SHA-384", or "SHA-512"
		},
		true, //whether the key is extractable (i.e. can be used in exportKey)
		["sign", "verify"] //can be any combination of "sign" and "verify"
	).then(function(key){
		//returns a keypair object
		console.log(key);
		console.log(key.publicKey);
		console.log(key.privateKey);
		return key;
	}).catch(function(err){
		console.error(err);
	});
}

function decodeBigInt(s)
{
	return BigInt("0x" + bin2hex(b64decode(s)), 16);
}

function bin2hex(s)
{
	return s
		.split('')
		.map( c => ('00' + c.charCodeAt(0).toString(16)).slice(-2) )
		.join('')
		;
}

function b64decode(s)
{
	// convert the web-safe base64uri encoding to what is accepted
	// by the builtin decoder.
	const b = s.replaceAll("-","+").replaceAll("_","/");
	return window.atob(b);
}


/*
 * Generate an RSA key pair as big ints.
 *
 * 
 */
async function rsaKey()
{
	const keys = await _rsaKey();
	const priv  = await crypto.subtle.exportKey("jwk", keys.privateKey);

	return {
		e: decodeBigInt(priv.e),
		d: decodeBigInt(priv.d),
		n: decodeBigInt(priv.n),
		p: decodeBigInt(priv.p),
		q: decodeBigInt(priv.q),
	};
}

// test it
async function rsaTest()
{
	let k = await rsaKey();
	let m = 1234n
	let r = modExp(modExp(m, k.e, k.n), k.d, k.n)
	if (r != m)
		console.log("FAIL", r, m);
}
