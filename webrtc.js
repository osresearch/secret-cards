/*
 * copied from https://grencez.dev/2020/webrtc-text-chat-20200614/
 */
"use strict";

class DataChannel
{
	constructor(offer=null)
	{
		//const url_params = new URLSearchParams(window.location.search);
		this.offer = offer; // url_params.get("webrtc_offer");
		this.is_webrtc_initiator = !this.offer;

		this.peer_connection = new RTCPeerConnection({
			'iceServers': [
			{'urls': 'stun:stun.l.google.com:19302'},
			{'urls': 'stun:stun2.l.google.com:19302'},
			],
		});

		if (this.is_webrtc_initiator) {
			// setup the data channel immediately
			this.init_data_channel(this.peer_connection.createDataChannel('chat_chan'));

			// and create an offer (via a chain of promises)
			// we have to wait for the ice gathering promise to be complete
			// before publshing our offer
			this.peer_connection.createOffer()
				.then(offer => {
					console.log(offer);
					this.peer_connection.setLocalDescription(offer);
				})
				.then(() => this.promise_ice_gathered())
				.then(offer => {
					console.log("full", offer);
					this.offer = window.btoa(JSON.stringify(offer));
					if (this.offer_ready)
						this.offer_ready(this.offer);
				})
				.then(() => new Promise(r => this.resume = r))
				.catch(e => {
					console.log("OFFER CREATE FAILED", e);
				});
		} else {
			// wait for the data channel event to occur before setting up the channel
			this.peer_connection.addEventListener("datachannel", ev => {
				this.init_data_channel(ev.channel);
			});

			// atempt to rendezvous with the initiator
			this.peer_connection.setRemoteDescription(JSON.parse(window.atob(this.offer)));

			// create the answer that they need to accept us
			// we have to wait for the ice gathering promise to be complete
			// before we publish our answer
			this.peer_connection.createAnswer()
				.then(answer => {
					console.log("answer", answer);
					this.peer_connection.setLocalDescription(answer);
				})
				.then(() => this.promise_ice_gathered())
				.then(answer => {
					console.log('answer2', answer);
					this.answer = window.btoa(JSON.stringify(answer));
					if (this.offer_ready)
						this.offer_ready(this.answer);
				})
				.catch(e =>
					console.log("ERROR", e)
				);
		}

		if(0)
		this.peer_connection.onicecandidate = (e) => {
			if (!e.candidate)
				return;
			// Don't actually send the peer any candidates.
			// We wait for gathering to complete (in promise_ice_gathered()),
			// then send our connection info to the peer in one shot.
			console.log("onicecandidate", e);
		};
	}

	init_data_channel(c)
	{
		console.log("init channel", c);
		this.channel = c;
		this.channel.onopen = () => { console.log("OPEN") };
		this.channel.onmessage = (m) => { console.log("MESSAGE", m) };
	}

	promise_ice_gathered()
	{
		const peer_connection = this.peer_connection;
		return new Promise(r => {
			peer_connection.addEventListener("icegatheringstatechange", e => {
				console.log("icegatheringstatechange", e);
				if (e.target.iceGatheringState === "complete")
					r(peer_connection.localDescription);
			});
		});
	}
				
	accept(reply)
	{
		const answer = JSON.parse(window.atob(reply));
		console.log(this.resume, answer);
        	this.peer_connection.setRemoteDescription(answer);
		this.resume();
	}

}
