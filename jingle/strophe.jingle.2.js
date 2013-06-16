/**
 * Jingle XMPP extensions, see http://xmpp.org/extensions/xep-0166.html
 *
 * Requires Disco plugin
 *
 * Authors:
 *   - Michael Weibel <michael.weibel@gmail.com>
 *
 * Some implementation taken from webRTC examples by Harald Alvestrand, Copyright 2012 Google.
 *
 * Copyright:
 *   - Michael Weibel <michael.weibel@gmail.com>
 */

if (window.webkitPeerConnection || window.webkitPeerConnection00 || window.webkitDeprecatedPeerConnection) {
	window.PeerConnection = window.webkitPeerConnection || window.webkitPeerConnection00 || window.webkitDeprecatedPeerConnection;
	window.URL = window.webkitURL;
	navigator.getUserMedia = navigator.webkitGetUserMedia;
} else if (window.mozRTCPeerConnection) {
	window.PeerConnection = window.mozRTCPeerConnection;
	navigator.getUserMedia = navigator.mozGetUserMedia;
}

Strophe.addConnectionPlugin('jingle', (function(self) {
	var _connection,
		_activeCalls = [],
		_initiator,
		STATUS = {
			NEW: "new",
			PREPARING_OFFER: "preparing-offer",
			OFFER_SENT: "offer-sent",
			OFFER_RECEIVED: "offer-received",
			OFFER: "offer",
			ESTABLISHED: "established",
			PREPARING_ANSWER: "preparing-answer",
			ANSWER: "answer",
			ANSWER_RECEIVED: "answer-received",
			OK: "ok",
			CLOSED: "closed"
		},
		
		/** Function: _escapeJid
		 * Escapes a jid (node & resource get escaped)
		 *
		 * See:
		 *   XEP-0106
		 *
		 * Author: Candy by Patrick Stadler & Michael Weibel
		 *         http://candy-chat.github.com/candy
		 *
		 * Parameters:
		 *   (String) jid - Jid
		 *
		 * Returns:
		 *   (String) - escaped jid
		 */
		_escapeJid = function(jid) {
			var node = Strophe.escapeNode(Strophe.getNodeFromJid(jid)),
				domain = Strophe.getDomainFromJid(jid),
				resource = Strophe.getResourceFromJid(jid);

			jid = node + '@' + domain;
			if (resource) {
				jid += '/' + Strophe.escapeNode(resource);
			}

			return jid;
		},
		
		_assertCallStatus = function(expected, actual) {
			if (expected !== actual) {
				throw "Invalid sdp messageType for current call status";
			}
		},
		
		_getUserMedia = function(cb) {
			navigator.getUserMedia({"video": true, "audio": true}, _gotStream.bind(this, cb), _gotStreamFailed.bind(this));
		},
		
		_gotStream = function(cb, s) {
			var url = URL.createObjectURL(s);
			_localView.attr('src', url);
			_localStream = s;
			if (cb) {
				cb();
			}
		},

		_gotStreamFailed = function(error) {
			console.log("STREAMFAILED");
			console.log(error);
		},

		/** PrivateFunction: _xmlHtmlNode
		 * Create a DOMParser and parse the given xml 
		 *
		 * From Strophe.js
		 *
		 * License: MIT
		 * Copyright 2006-2008, OGG, LLC
		 */
		_xmlHtmlNode = function (xml) {
			if (window.DOMParser) {
				parser = new DOMParser();
				node = parser.parseFromString(xml, "text/xml");
			} else {
				node = new ActiveXObject("Microsoft.XMLDOM");
				node.async="false";
				node.loadXML(xml);
			}
			return node;
		},
		_generateSdpJsonFromSdp = function(sdp, info) {
			var str = "SDP\n{\n";
			if (info.attr('answererid')) {
				str += "   \"answererSessionId\" : \"" + info.attr('answererid') + "\",\n";
			}
			str += "   \"messageType\" : \"" + info.attr('type') + "\",\n";
			if (info.attr('offererid')) {
				str += "   \"offererSessionId\" : \"" + info.attr('offererid') + "\",\n";
			}
			if (sdp) {
				str += "   \"sdp\" : \"" + sdp + "\",\n";
			}
			str += "   \"seq\" : " + parseInt(info.attr('seq'), 10);
			if (info.attr('tiebreaker')) {
			 	str += ",\n   \"tieBreaker\" : " + parseInt(info.attr('tiebreaker'), 10);
			}
			return str + "\n}";
		},

		_jingleToSdp = function(stanza) {
			var $stanza = $(stanza),
				jingle = $stanza.children('jingle')[0],
				sdp = SDPToJingle.parseJingleStanza(Strophe.serialize(jingle));
				/*$info = $($(jingle).children('webrtc').children('session-info')[0]);*/

		 	return sdp;
		},
		_sdpToJingle = function(iq, msg, dontAppendJingleMedia) {
			if (dontAppendJingleMedia !== false) {
				var jingle = SDPToJingle.createJingleStanza(msg);

				iq.attrs({'sid': jingle.sid});
				iq.node.appendChild(_xmlHtmlNode(jingle.audio).documentElement);
				iq.node.appendChild(_xmlHtmlNode(jingle.video).documentElement);
			}
		},
		
		_recipientSupportsJingle = function(jid) {
			var supportedSpecs = _connection.caps.getCapabilitiesByJid(jid);
			if(supportedSpecs) {
				for(var i = 0, len = supportedSpecs.length; i < len; i++) {
					if (supportedSpecs[i].attributes[0].value === Strophe.NS.JINGLE) {
						return true;
					}
				}
			}
			return false;
		};
	
	self.MAX_CONCURRENT_CALLS = 1;
	
	self.init = function(conn) {
		_connection = conn;
		_initiator = _connection.jid;

		Strophe.addNamespace('JINGLE', 'urn:xmpp:jingle:1');
		Strophe.addNamespace('JINGLE_ERRORS', 'urn:xmpp:jingle:errors:1');
		Strophe.addNamespace('JINGLE_RTP', 'urn:xmpp:jingle:apps:rtp:1');
		Strophe.addNamespace('JINGLE_RTP_ERRORS', 'urn:xmpp:jingle:apps:rtp:errors:1');
		Strophe.addNamespace('JINGLE_RTP_INFO', 'urn:xmpp:jingle:apps:rtp:info:1');
		Strophe.addNamespace('JINGLE_RTP_AUDIO', 'urn:xmpp:jingle:apps:rtp:audio');
		Strophe.addNamespace('JINGLE_RTP_VIDEO', 'urn:xmpp:jingle:apps:rtp:video');
		Strophe.addNamespace('JINGLE_TRANSPORTS_ICE_UDP', 'urn:xmpp:jingle:transports:ice-udp:1');
		Strophe.addNamespace('JINGLE_TRANSPORTS_RAW_UDP', 'urn:xmpp:jingle:transports:raw-udp:1');
		Strophe.addNamespace('JINGLE_TRANSPORTS_WEBRTC', 'urn:xmpp:jingle:transports:webrtc:1');

		if (navigator.getUserMedia && window.PeerConnection && _connection.disco) {
			_connection.disco.addFeature(Strophe.NS.JINGLE);
			_connection.disco.addFeature(Strophe.NS.JINGLE_TRANSPORTS_WEBRTC);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_AUDIO);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_VIDEO);
		} else {
			throw "One of navigator.getUserMedia, window.PeerConnection or _connection.disco is missing";
		}
	};
	
	/** Function: setServer
	 * Sets STUN/TURN Server to use when connecting.
	 *
	 * Needs to be called before any initSession/accept session occurs
	 *
	 * Parameters:
	 *   (String) config - STUN/TURN Server string, e.g. STUN example.com:3478
	 */
	self.setServer = function(config) {
		_serverConfig = config;
	};

	/** Function: setLocalView
	 * Set video-element which will display the own webcam.
	 *
	 * Parameters:
	 *   (Element) el - Video element
	 */
	self.setLocalView = function(el) {
		_localView = el;
	};
	
	self.isBusy = function() {
		return self.MAX_CONCURRENT_CALLS <= _activeCalls.length;
	}
	
	/** Constructor: JingleCall
	 * Start a new jingle call.
	 *
	 * Parameters:
	 *   (Element) remoteView - Remote video element
	 *   (Function) cb - Callback when local user media has been established.
	 */
	self.JingleCall = function(remoteView, cb) {
		if (self.isBusy()) {
			console.log(_activeCalls);
			throw "Max Number of Calls reached";
		}
		_activeCalls.push(this);
		
		this._remoteView = remoteView;
		
		if(_activeCalls.length === 1) {
			_getUserMedia(cb);
		} else {
			cb();
		}
	};
	
	self.JingleCall.prototype = (function() {
		return {
			initSession: function(to, name, media, successCallback) {
				this._to = this._responder = _escapeJid(to);
				this._from = this._initiator = _escapeJid(_connection.jid);
				this._name = name;
				this._media = media;
				this._successCallback = successCallback;
				this._sid = Math.random().toString(36).substr(10, 30);

				if (!_recipientSupportsJingle(this._responder)) {
					return false;
				}
				
				//this._createPeerConnection(this._handleSdp.bind(this));
				this._createPeerConnection();
				/*var offer = this._peerConnection.createOffer({"has_audio": true, "has_video": true});
				this._peerConnection.setLocalDescription(this._peerConnection.SDP_OFFER, offer);
				this._peerConnection.startIce();
				this._handleSdp(offer.toSdp());*/
				return true;
			},
			
			/** Function: handleSessionInit
			 * Acts upon a session-initiate stanza
			 *
			 * Parameters:
			 *   (String) stanza - XMPP Stanza
			 *   (Function) cb - Callback after session-accept or session-terminate has been sent
			 *
			 * Returns:
			 *   (Boolean) - true if ok, false if not ok
			 */
			handleSessionInit: function(stanza, successCallback) {
				var $stanza = $(stanza),
					from = $stanza.attr('from'),
					id = $stanza.attr('id')
					$jingle = $($stanza.children('jingle')[0]),
					contents = $jingle.children('content'),
					sdp = _jingleToSdp(stanza);

				this._sendAck(from, id);
				this._to = this._initiator = _escapeJid(from);
				this._from = this._responder = _escapeJid(_connection.jid);
				this._sid = $jingle.attr('sid');
				this._successCallback = successCallback;
				
				this._createPeerConnection();
				this._onSignalingMessage(sdp);
			},
			
			handle: function(stanza) {
				var $stanza = $(stanza),
					from = $stanza.attr('from'),
					id = $stanza.attr('id');
				this._sendAck(from, id);
				
				if ($stanza.children('jingle').attr('action') === 'session-terminate') {
					this.terminate(false);
				} else {
					this._onSignalingMessage(_jingleToSdp(stanza));	
				}
				return true;
			},
			
			terminate: function(sendTerminateStanza) {
				this._state = STATUS.CLOSED;
				this._peerConnection.removeStream(this._remoteStream);
				this._peerConnection.remoteStreams[0] = null;
				this._peerConnection.close();
				this._peerConnection = null;

				if (sendTerminateStanza !== false) {
					var iq = $iq({
						'from': _connection.jid,
						'to': _receiver ? _initiator : _responder,
						'type': 'set'
					});
					iq.c('jingle', {
						'xmlns': Strophe.NS.JINGLE,
						'action': 'session-terminate',
						'initiator': _initiator,
						'responder': _responder,
						'sid': _sid
					})
					.c('reason').c('success');

					_connection.sendIQ(iq);
				}
			},
			
			/** PrivateFunction: _handleSdp
			 * Handles all sdp messages received by the opened PeerConnection.
			 *
			 * Parameters:
			 *   (String) msg - SDP Message
			 *
			 * TODO:
			 *   - Little refactoring to DRY it
			 */
			_handleSdp: function(msg) {
				console.log("handlesdp", msg, this._state);
				var iq = $iq({'from': this._from, 'to': this._to, 'type': 'set'})
					.c('jingle', {
						'xmlns' : Strophe.NS.JINGLE,
						'initiator' : this._initiator,
						'responder' : this._responder/*,
						'sid' : this._sid*/
					}); // iq is now jingle
				switch(this._state) {
					case STATUS.PREPARING_OFFER:
						//_assertCallStatus("OFFER", jsonSdp.messageType);
						iq.attrs({'action' : 'session-initiate'});
						_sdpToJingle(iq, msg);
						
						_connection.sendIQ(iq);
						
						this._state = STATUS.ANSWER;
						break;
					case STATUS.OFFER:
						//_assertCallStatus("ANSWER", jsonSdp.messageType);
						
						iq.attrs({'action' : 'session-info'});
						
						_sdpToJingle(iq, msg);
						_connection.sendIQ(iq);
						
						this._state = STATUS.OK;
						break;
					case STATUS.PREPARING_ANSWER:
						//_assertCallStatus("OK", jsonSdp.messageType);
						iq.attrs({'action' : 'session-accept'});

						_sdpToJingle(iq, msg);

						_connection.sendIQ(iq);

						if (this._successCallback) {
							this._successCallback();
						}
						
						this._state = STATUS.ESTABLISHED;
						break;
					case STATUS.ANSWER_RECEIVED:
						iq.attrs({'action' : 'session-accept'});

						_connection.sendIQ(iq);

						if (this._successCallback) {
							this._successCallback();
						}
					
						this._state = STATUS.ESTABLISHED;
						break;
					case STATUS.ESTABLISHED:
						break;
					default:
						throw "Invalid status";
				}
			},
			
			_sendAck: function(to, id) {				
				_connection.sendIQ($iq({
					'from': _connection.jid,
					'to': to,
					'id': id,
					'type': 'result'
				}));
			},
			
			/** PrivateFunction: _createPeerConnection
			 * Creates a new PeerConnection, registers handlers on it and sets the localView.
			 *
			 * Parameters:
			 *   (Function) peerConnectionCallback - Callback for sdp messages
			 */
			_createPeerConnection: function(peerConnectionCallback) {
				var self = this;
				
				this._actionNeeded = false;
				this._iceStarted = false;
				this._moreIceComing = true;
				this._iceCandidateCount = 0;
				this._state = STATUS.NEW;
				this._markActionNeeded();
				this._prevOffer = "";
				this._receivedOffer = "";
				this._candidates = [];
				
				this._peerConnection = new PeerConnection(_serverConfig, function(candidate, more) {
					if (candidate) {
						self._candidates.push(candidate);
					}
					if (more == false) {
						self._moreIceComing = false;
						if (self._state !== STATUS.ESTABLISHED) {
							self._markActionNeeded();
						}
					}
					self._iceCandidateCount++;
				});
				
				this._peerConnection.addStream(_localStream);
				
				this._peerConnection.onaddstream = function(e) {
					console.log(self._remoteView);
					var stream = e.stream,
						url = URL.createObjectURL(stream);
					self._remoteView.attr('src', url);
					self._remoteStream = stream;
				}
				this._peerConnection.onsignalingmessage = this._onSignalingMessage.bind(this);
				this._peerConnection.onremovestream = function(e) {
					console.log("ONREMOVESTREAM");
					self._remoteView.attr('src', '');
					self._remoteStream = null;
				}
				this._peerConnection.onmessage = function(e) {
					console.info("ONMESSAGE");
					console.log(e);
				}
				this._peerConnection.onopen = function(e) {
					console.info("ONOPEN");
					console.log(e);
				}
				this._peerConnection.onconnecting = function(e) {
					console.info("ONCONNECT");
					console.dir(e);
				}
				this._peerConnection.onstatechange = function(e, state) {
					console.info("ONSTATECHANGE");
					console.dir(e ,state);
				}
			},
			
			_onSignalingMessage: function(msg) {
				console.log("signalingmsg", msg, "state: " + this._state);
				console.log(this._peerConnection);
				var sdp = new SessionDescription(msg);
				if (this._state == STATUS.NEW) {
					this._state = STATUS.OFFER_RECEIVED;
					this._receivedOffer = msg;
					this._peerConnection.setRemoteDescription(this._peerConnection.SDP_OFFER,
						sdp);
					this._markActionNeeded();
				} else if (this._state = STATUS.OFFER_SENT) {
					console.log("OFFERSENT -> ANSWER_RECEIVED");
					this._state = STATUS.ANSWER_RECEIVED;
					this._receivedOffer = msg;
					this._peerConnection.setRemoteDescription(this._peerConnection.SDP_ANSWER, 
						sdp);
					this._markActionNeeded();
				} else if (this._state === STATUS.ESTABLISHED) {
					console.log('foobar');
				}
			},
			
			_onStableState: function() {
				var sdp;
				if (this._actionNeeded) {
					if (this._state === STATUS.NEW || this._state === STATUS.ESTABLISHED) {
						// TODO: Be able to configure this
						var newOffer = this._peerConnection.createOffer({
							has_audio: true,
							has_video: true
						});
						if (newOffer.toSdp() != this._prevOffer && this._receivedOffer === "") {
							this._peerConnection.setLocalDescription(this._peerConnection.SDP_OFFER,
								newOffer);
							this._peerConnection.startIce();
							this._state = STATUS.PREPARING_OFFER;
							this._markActionNeeded();
							return;
						}
					} else if (this._state === STATUS.PREPARING_OFFER) {
						if (this._moreIceComing) {
							return;
						}
						this._prevOffer = this._peerConnection.localDescription.toSdp();
						this._handleSdp(this._prevOffer);
						this._state = STATUS.OFFER_SENT;
					} else if (this._state === STATUS.OFFER_RECEIVED) {
						console.log("OFFER_RECEIVED");
						// TODO: Configurable
						sdp = this._peerConnection.createAnswer(this._receivedOffer, {
							has_audio: true,
							has_video: true
						});
						this._peerConnection.setLocalDescription(this._peerConnection.SDP_ANSWER, 
							sdp);
						this._state = STATUS.PREPARING_ANSWER;
						if (!this._iceStarted) {
							this._peerConnection.startIce();
							this._iceStarted = true;
						} else {
							this._markActionNeeded();
							return;
						}
					} else if (this._state === STATUS.PREPARING_ANSWER) {
						console.log("PREPARING_ANSWER");
						if (this._moreIceComing) {
							return;
						}
						sdp = this._peerConnection.localDescription.toSdp();
						this._handleSdp(sdp);
						this._state = STATUS.ESTABLISHED;
					} else if (this._state === STATUS.ANSWER_RECEIVED) {
						//this._handleSdp();
					} else {
						//throw "Invalid state " + this._state;
					}
					this._actionNeeded = false;
				}
			},
			
			_markActionNeeded: function() {
				this._actionNeeded = true;
				var self = this;
				this._doLater(function() {
					self._onStableState();
				});
			},
			
			_doLater: function(what) {
				// Post an event to myself so that I get called a while later.
				// (needs more JS/DOM info. Just call the processing function on a delay
				// for now.)
				window.setTimeout(what, 1);
			}
		}
	}());
	
	return self;
})({}));