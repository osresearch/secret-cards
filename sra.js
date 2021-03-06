/*
 * Implement the SRA commutative encryption algorithm.
 * This is similar to RSA, but allows multiple parties to
 * encrypt the message in any order, and then decrypt it in
 * any order.
 *
 * This needs the utils.js module for bigint to stuff.
 */

(function (exports) {
'use strict'

// default prime is the 15th Mersenne prime, which has 1279 bits and
// which serves as a nothing up-my-sleeves number to provide similar
// security to RSA2048.
//const sra_default_prime = 2n ** 1279n - 1n;
const sra_default_prime = 2n ** 521n - 1n;

/*
 * Compute a^e % n with big integers
 * using the modular exponentiation so that it can be done
 * in (non-constant) log2 time.
 */
function modExp(a, e, n)
{
	if (typeof(a) === "string")
		a = BigInt("0x" + a);
	if (typeof(e) === "string")
		e = BigInt("0x" + e);

	let r = 1n;
	let x = a % n;

	while (e != 0n)
	{
		//if (e % 2n)
		if (e & 1n)
			r = (r * x) % n;

		//e /= 2n;
		e >>= 1n;
		x = (x * x) % n;
	}

	return r.toString(16);
}


class SRA
{
	constructor(p=0n)
	{
		this.p = p ? p : sra_default_prime;

		const phi_p = this.p - 1n;
		const bits = 256; // fast encryption, slower decryption
		
		while(true)
		{
			// choose a random encryption key and check to see if it
			// is relatively prime to the modulus.
			let k = utils.randomBigint(bits);
			//console.log("SRA: trying", k);

			// gcd(k,phi_p) == 1 means that they are relatively prime
			let g = this.egcd(k, phi_p);
			if (g.g != 1n)
				continue;

			// ensure modular inverse is also positive
			let inv = g.x;
			if (inv < 0)
				inv = inv + phi_p;

			this.e = k;
			this.d = inv;
			break;
		} 
	}

	/*
	 * Compute the extended Euler Greatest Common Denominator (GCD)
	 * of two BigInt values.
	 * Returns g, x, y such that a*x + b*y = g == gcd(a,b)
	 */
	egcd(a,b)
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

	/*
	 * Encrypt a bigint or binary string message with the SRA key, returning
	 * an encrypted bigint
	 */
	encrypt(m)
	{
		return modExp(m, this.e, this.p);
	}

	/*
	 * decrypt a bigint message with the SRA key into a bigint
	 */
	decrypt(c)
	{
		return modExp(c, this.d, this.p);
	}
}

exports.SRA = (p=0n) => new SRA(p);
exports.modExp = modExp;

})(typeof exports === 'undefined' ? this['sra']={} : exports);
