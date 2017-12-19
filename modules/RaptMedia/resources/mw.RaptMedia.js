/**
 * The RaptMedia plugin integrates the RaptMedia Engine to the Kaltura Player.
 * RaptMedia adds clickable interactive layer that accompanies your video content and can do things like:
 * cue or launch different media plays, jump to specific timecode, trigger an event on your webpage and launch a new web page or an app.
 * Learn more at http://docs.raptmedia.com/
 *
 * This plugins is only usable for raptmedia.com accounts who enabled integration with Kaltura.
 * If you don't have a RaptMedia account or need to enable the Kaltura integration, please contact support@raptmedia.com
 *
 * This plugin is only activated when the entryId provided is a Playlist Entry with partnerData == "raptmedia;projectId".
 * This plugin also makes use of accompanying plugin RaptMediaScrubber plugin to override the default scrubber behavior to fit a Rapt Media experience.
 * With RaptMediaScrubber plugin the scrubber can interact within the context of a single RaptMedia clip instead of just the entire stitched playlist.
 * The RaptMedia plugin integrates the RaptMedia Engine to the Kaltura Player.
 * It also makes use of accompanying plugin RaptMediaDurationLabel used to override the default player DurationLabel to behave according to the RaptMedia Sequence rather than show the overall playlist duration.
 */
(function ( mw, $ ) {
	"use strict";

	var AbortError = function() {};

	mw.PluginManager.add( 'raptMedia', mw.KBaseComponent.extend( {

		defaultConfig: {
			raptMediaScriptUrl: 'https://cdn1.raptmedia.com/system/player/v1/engine.min.js',
			parent: 'videoHolder'
		},

		setup: function(){
			this.initialize();
			this.addBindings();
		},

		initialize: function() {
			this.setConfig('status', 'disabled', true);

			this.setConfig('projectId', undefined, true);
			this.setConfig('info', undefined, true);
		},

		addBindings: function() {
			var _this = this;

			this.bind('raptMedia_doPlay', function(event) {
				_this.execute({ type: 'player:play' });
			});

			this.bind('raptMedia_doPause', function(event) {
				_this.execute({ type: 'player:pause' });
			})

			this.bind('raptMedia_doSeek', function(event, time) {
				_this.execute({ type: 'player:seek', payload: { time: time } });
			});

			this.bind('raptMedia_doJump', function(event, locator) {
				_this.execute({ type: 'project:jump', payload: { destination: locator } });
			});

			this.bind('raptMedia_doReplay', function(event) {
				_this.execute({ type: 'project:replay' });
			});

			this.bind('raptMedia_doCommand', function(event, command) {
				_this.execute(command);
			});

			this.bind('checkPlayerSourcesEvent', function(event, callback) {
				_this.playbackCallback = callback;
			});

			this.bind('KalturaSupport_EntryDataReady', function(event) {
				// KalturaSupport_EntryDataReady can be called synchronously from a
				// `checkPlayerSourcesEvent` handler if the required data is already
				// cached. In that case `_this.playbackCallback` may not be available
				// synchronously, so we force asynchronous evaluation
				setTimeout(function() {
					_this.log('Checking if Entry is an Interactive Video');

					var raptProjectId = _this.readRaptProjectId();
					if (raptProjectId) {
						_this.once('raptMedia_ready', _this.playbackCallback);
						_this.enableRapt(raptProjectId);
					} else {
						_this.playbackCallback();
					}
				}, 0);
			});

			this.bind('onChangeMedia', function(event) {
				var entryId = _this.getPlayer().kentryid;

				if (_this.isEnabled() && _this.entries && _this.entries.indexOf(entryId) === -1) {
					_this.disableRapt();
				}
			});

			this.bind('updateLayout', function(){
				_this.resizeEngine();
			});

			this.bind('monitorEvent onplay onpause ended', function(){
				_this.updateEngine();
			});

			this.bind('seeked', function() {
				// Attempt to work around mobile safari weirdness
				setTimeout(function() {
					_this.updateEngine();
				}, 0);
			});

			this.bind('Kaltura_ConfigChanged', function(event, pluginName, property, value) {
				if (_this.raptMediaEngine == null) { return; }
				if (pluginName === 'googleAnalytics' && property === 'urchinCode') {
					_this.raptMediaEngine.execute({ type: 'config:set', payload: { key: 'ga', value: value } });
				}
			});
		},

		readRaptProjectId: function() {
			var partnerData = this.getPlayer().evaluate('{mediaProxy.entry.partnerData}');
			var segments = (partnerData || "").split(';');
			return partnerData != null && segments.length >= 2 && segments[0] === 'raptmedia' && segments.slice(1).join(';');
		},

		enableRapt: function(raptProjectId) {
			var _this = this;
			this.log('Enabling interactive video functionality');

			this.setConfig('status', 'loading', true);
			this.setConfig('projectId', raptProjectId, true);

			// Keep list of entries that are part of this project
			this.entries = this.getPlayer().evaluate('{mediaProxy.entry.playlistContent}').split(',');

			// Store original config so they can be restored later
			this.originalConfig = {
				onDoneInterfaceFlag: this.getPlayer().onDoneInterfaceFlag,
				shouldEndClip: this.getPlayer().shouldEndClip,

				'EmbedPlayer.ShowPosterOnStop': this.getPlayer().getFlashvars('EmbedPlayer.ShowPosterOnStop'),

				'EmbedPlayer.HidePosterOnStart': mw.getConfig('EmbedPlayer.HidePosterOnStart'),
				'EmbedPlayer.KeepPoster': mw.getConfig('EmbedPlayer.KeepPoster'),
			}

			// Attempt to prevent the last segment from incorrectly triggering ended / replay behavior
			this.getPlayer().onDoneInterfaceFlag = false;
			this.getPlayer().shouldEndClip = false;

			// Don't show the poster at the end of a node
			this.getPlayer().setFlashvars('EmbedPlayer.ShowPosterOnStop', false);

			// Keep the poster around until playback begins
			mw.setConfig('EmbedPlayer.KeepPoster', true);

			this.loadEngine()
			.then(function() {
				if (raptProjectId !== _this.getConfig('projectId')) {
					return _this.reject(new AbortError);
				}

				_this.log('Loading rapt project');

				return _this.loadProject(raptProjectId);
			}).then(function() {
				if (raptProjectId !== _this.getConfig('projectId')) {
					return _this.reject(new AbortError);
				}

				if (_this.$el)
					_this.$el.show();

				_this.log('Starting rapt project');

				_this.setConfig('status', 'enabled', true);
				_this.emit('raptMedia_ready');
			}).then(null, function(error) {
				if (error instanceof AbortError) {
					_this.log('Aborted project load');
				} else {
					_this.log(error);
					_this.fatal('Unable to load rapt media project');
				}
			});
		},

		disableRapt: function() {
			this.log('Disabling interactive video functionality');

			var status = this.getConfig('status');
			if (status === 'disabled') {
				this.log('Already disabled');
				return;
			}

			this.initialize();

			this.getPlayer().getInterface().removeClass('raptMedia_running');

			this.entries = null;

			if (this.originalConfig) {
				this.log('Restoring settings');

				this.getPlayer().onDoneInterfaceFlag = this.originalConfig.onDoneInterfaceFlag;
				this.getPlayer().shouldEndClip = this.originalConfig.shouldEndClip;
				this.getPlayer().setFlashvars('EmbedPlayer.ShowPosterOnStop', this.originalConfig['EmbedPlayer.ShowPosterOnStop']);
				mw.setConfig('EmbedPlayer.HidePosterOnStart', this.originalConfig['EmbedPlayer.HidePosterOnStart']);
				mw.setConfig('EmbedPlayer.KeepPoster', this.originalConfig['EmbedPlayer.KeepPoster']);
			}

			this.originalConfig = null;

			// Re-enable ended / replay behavior
			this.getPlayer().onDoneInterfaceFlag = true;

			this.emit('raptMedia_cleanup');
			this.unbind('raptMedia_ready');

			if (this.$el)
				this.$el.hide();
		},

		// Utility Functions

		isEnabled: function() {
			return this.getConfig('status') === 'enabled';
		},

		emit: function(event, data) {
			this.getPlayer().sendNotification(event, data);
		},

		fatal: function(title, message) {
			this.setConfig('status', 'error', true);
			this.getPlayer().layoutBuilder.displayAlert({
				isError: true,
				isModal: true,

				keepOverlay: true,
				noButtons: true,

				title: title || "Fatal error in Rapt Media project",
				message: message
			});
		},

		promise: function(fn) {
			var deferred = $.Deferred(function(defer) {
				try {
					fn(defer.resolve, defer.reject);
				} catch(e) {
					defer.reject(e);
				}
			});

			return deferred.promise();
		},

		reject: function(error) {
			return this.promise(function(_, reject) {
				reject(error);
			});
		},

		execute: function(command) {
			if (!this.raptMediaEngine || !this.isEnabled()) {
				this.log('WARNING: Rapt Media commands received before initialization is complete');
				return;
			}

			this.raptMediaEngine.execute(command);
		},

		// Initialization Support

		loadEngine: function() {
			var _this = this;
			if (this.enginePromise) { return this.enginePromise; }

			var raptMediaScriptUrl = this.getConfig( 'raptMediaScriptUrl' );
			this.log('Loading rapt media engine: ' + raptMediaScriptUrl);

			this.enginePromise = $.ajax({ dataType: 'script', url: raptMediaScriptUrl, cache: true })
				.then(function() {
					_this.log('Loaded rapt media engine successfuly: ' + raptMediaScriptUrl);
				}, function( jqxhr, settings, exception ) {
					_this.log('Failed to load script: ' + raptMediaScriptUrl + ', ' + exception);
					_this.fatal(
						'Error loading RAPT Media engine',
						'Error loading the Rapt Media engine.'
					);
				});

			return this.enginePromise;
		},

		getComponent: function () {

			if ( ! this.$el) {
				this.$el = $( "<div></div>" ).attr( 'id', 'raptMediaOverlay' ).addClass( this.getCssClass() );
			}

			return this.$el;
		},

		getDelegate: function () {
			var _this = this;

			if (this.delegate) { return this.delegate; }

			return this.delegate = {
				element: this.getComponent()[0],

				load: function(media, flags) {
					var entryId = media.sources[0].src;

					function change() {
						_this.log('Changing media');
						_this.getPlayer().sendNotification('changeMedia', { entryId: entryId });
					}

					return _this.promise(function(resolve, reject) {
						if (_this.getPlayer().currentState === 'start') {
							_this.log('Project not started, deferring changeMedia');
							_this.pendingEntryId = entryId;
							resolve();
						} else if (_this.getPlayer().changeMediaStarted) {
							_this.log('Change media already in progress, waiting');
							_this.once('onChangeMediaDone', change);
							resolve();
						} else {
							change();
							_this.once('onChangeMediaDone', resolve);
						}
					});
				},

				play: function() {
					if (!_this.getPlayer().changeMediaStarted) {
						_this.getPlayer().sendNotification('doPlay');
					}
				},

				pause: function() {
					_this.getPlayer().sendNotification('doPause');
				},

				seek: function(time) {
					_this.getPlayer().sendNotification('doSeek', time);
				},

				event: function(event) {
					// Clear before set to prevent default object merge behavior
					_this.setConfig('info', undefined, true);
					_this.setConfig('info', _this.raptMediaEngine.evaluate(), true);

					switch (event.type) {
						case 'project:ended':
							// TODO: Trigger end screen
							break;
						case 'project:start':
							if (_this.pendingEntryId) {
								setTimeout(function() {
									_this.log('Loading pending entry:' + _this.pendingEntryId);
									_this.getPlayer().sendNotification('changeMedia', { entryId: _this.pendingEntryId });
									_this.pendingEntryId = null;
								}, 0);
							}

							// Hide poster during transitions
							mw.setConfig('EmbedPlayer.KeepPoster', false);
							mw.setConfig('EmbedPlayer.HidePosterOnStart', true);

							// Hide undesirable UI elements
							_this.getPlayer().getInterface().addClass('raptMedia_running');

							// Get rid of the poster
							_this.getPlayer().removePoster();
							break;
					}

					_this.emit("raptMedia_event", event);
				},

				error: function(error) {
					console.error(error);
					_this.log('Error from rapt media engine: ' + error);
					_this.fatal(
						'Error in RAPT Media engine',
						'Something went wrong.'
					);
				},
			};
		},

		loadProject: function(projectId) {
			var _this = this;

			if (!this.raptMediaEngine) {
				var config = this.getConfig('raptEngine') || {};

				var ua = this.getPlayer().getKalturaConfig('googleAnalytics', 'urchinCode');
				if (ua != null) {
					config.ga = ua;
				}

				this.raptMediaEngine = new Rapt.Engine(
					this.getDelegate(),
					config
				);
			}

			this.resizeEngine();

			return this.promise(function(resolve, reject) {
				_this.raptMediaEngine.load(projectId).then(resolve, reject);
			});
		},

		updateEngine: function(){
			if (!this.isEnabled()) {
				return;
			}

			var player = this.getPlayer();

			if (player.seeking) {
				return;
			}

			this.raptMediaEngine.update({
				currentTime: player.currentTime,
				duration: player.duration,
				paused: !player.isPlaying(),

				ended: (player.duration - player.currentTime) < 0.25 && player.isStopped(),

				videoWidth: player.evaluate('{mediaProxy.entry.width}'),
				videoHeight: player.evaluate('{mediaProxy.entry.height}'),

				readyState: player.getPlayerElement().readyState,
			});
		},

		resizeEngine: function() {
			var _this = this;

			if (!this.raptMediaEngine) { return; }

			this.raptMediaEngine.resize({
				width: _this.getPlayer().getVideoHolder().width(),
				height: _this.getPlayer().getVideoHolder().height()
			});
		},

		isValidApiResult: function (data) {
			if (!data){
				this.error = true;
				this.log("API Error retrieving data");
				return false;
			} else if ( data.code && data.message ) {
				this.error = true;
				this.log("API Error code: " + data.code + ", error message: " + data.message);
				return false;
			}
			this.error = false;
			return true;
		},

	} ) );
} ) ( window.mw, window.jQuery );
