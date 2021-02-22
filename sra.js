/*
 * Implement the SRA commutative encryption algorithm.
 * This is similar to RSA, but allows multiple parties to
 * encrypt the message in any order, and then decrypt it in
 * any order.
 */
class SRA
{
	// default prime is the 15th Mersenne prime, which has 1279 bits and
	// which serves as a nothing up-my-sleeves number to provide similar
	// security to RSA2048.
	default_prime = 2n ** 1279n - 1n;

	constructor(p=0n)
	{
		this.p = p ? p : this.default_prime;

		let phi_p = this.p - 1n;
		let dec_digits = (""+ phi_p).length;
		let bits = dec_digits * 3;
		
		while(true)
		{
			// choose a random encryption key and check to see if it
			// is relatively prime to the modulus.
			let k = randomBigint(bits);
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
	}

	/*
	 * Compute a^e % n with big integers
	 * using the modular exponentiation so that it can be done
	 * in (non-constant) log2 time.
	 */
	modExp(a, e, n)
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
	 * Encrypt a binary string message with the SRA key, returning
	 * an encrypted binary string.
	 */
	encrypt(m)
	{
		let mi = array2bigint(m);
		let ci = this.modExp(mi, this.d, this.p);
		return bigint2array(ci);
	}

	/*
	 * Encrypt a message with the SRA key
	 */
	decrypt(c)
	{
		let ci = array2bigint(c);
		let mi = this.modExp(ci, this.e, this.p);
		return bigint2array(mi);
	}
}
