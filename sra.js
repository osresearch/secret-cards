/*
 * Implement the SRA commutative encryption algorithm.
 * This is similar to RSA, but allows multiple parties to
 * encrypt the message in any order, and then decrypt it in
 * any order.
 *
 * This needs the utils.js module for bigint to stuff.
 * TODO: switch to using the msrcrypto library instead
 */

(function (exports) {
'use strict'

const cryptoMath = msrCrypto.cryptoMath;

function bigint2msr(x)
{
	let r = [];
	while(x)
	{
		const v = x & BigInt(cryptoMath.DIGIT_MASK);
		x >>= BigInt(cryptoMath.DIGIT_BITS);
		r.push(Number(v));
	}

	return r;
}

    function toBytes(digits) {

        var bytes = cryptoMath.digitsToBytes(digits);

        // Add leading zeros until the message is the proper length.
        utils.padFront(bytes, 0, modulusLength);

        return bytes;
    }

    function modExp(dataBytes, expBytes, modulusBytes) {
        /// <returns type="Array">Result in a digit array.</returns>
        var exponent = cryptoMath.bytesToDigits(expBytes);

        var group = cryptoMath.IntegerGroup(modulusBytes);
        var base = group.createElementFromBytes(dataBytes);
        var result = group.modexp(base, exponent);

        // var modulus = cryptoMath.bytesToDigits(modulusBytes);
        // var exponent = cryptoMath.bytesToDigits(expBytes);
        // var base = cryptoMath.bytesToDigits(dataBytes);

        // var result = cryptoMath.modExp(base, exponent, modulus);

        return result.m_digits;
    }

    function decryptModExp(cipherBytes) {

        var resultElement = modExp(cipherBytes, keyStruct.d, keyStruct.n);

        return toBytes(resultElement);
    }

// default prime is the 15th Mersenne prime, which has 1279 bits and
// which serves as a nothing up-my-sleeves number to provide similar
// security to RSA2048.
//const sra_default_prime = 2n ** 1279n - 1n;
//const sra_default_prime_hex = "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // 2n ** 607n - 1n;
//const sra_default_prime = cryptoMath.stringToDigits(sra_default_prime_hex, 16);
const sra_default_prime = 2n ** 607n - 1n;
const sra_group = cryptoMath.IntegerGroup(cryptoMath.digitsToBytes(bigint2msr(sra_default_prime)));

/*
 * Compute a^e % n with either hex strings or msrCrypto digits.
 * Returns a hex string
 *
 * if n is specified it must be a cryptoMath.IntegerGroup()
 */
function modExp(a, e, n=sra_group)
{
	if (typeof(a) === "string")
		a = cryptoMath.stringToDigits(a, 16);
	if (typeof(e) === "string")
		e = cryptoMath.stringToDigits(e, 16);

	let a_element = n.createElementFromDigits(a);
	let s = n.modexp(n.createElementFromDigits(a), e);

	// convert the result back to a hex string
	return cryptoMath.digitsToString(s.m_digits, 16);
}

class SRA
{
	constructor()
	{
		let bits = 600;
		let phi_p = sra_default_prime - 1n;
		//cryptoMath.subtract(this.p, [1], phi_p);
		
		while(true)
		{
			// choose a random encryption key and check to see if it
			// is relatively prime to the modulus.
			let k = utils.randomBigint(bits);
			console.log("trying", k);

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

		// convert things to the msrcrypto library format
		this.e = bigint2msr(this.e);
		this.d = bigint2msr(this.d);
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
		return modExp(m, this.e);
	}

	/*
	 * decrypt a bigint message with the SRA key into a bigint
	 */
	decrypt(c)
	{
		return modExp(c, this.d);
	}
}

exports.SRA = () => new SRA();
exports.modExp = modExp;

})(typeof exports === 'undefined' ? this['sra']={} : exports);
