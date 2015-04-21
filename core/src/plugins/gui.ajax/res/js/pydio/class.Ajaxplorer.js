/*
 * Copyright 2007-2013 Charles du Jeu - Abstrium SAS <team (at) pyd.io>
 * This file is part of Pydio.
 *
 * Pydio is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <http://pyd.io/>.
 */

/**
 * This is the main JavaScript class instantiated by AjxpBoostrap at startup.
 */
Class.create("Ajaxplorer", {

	/**
	 * Constructor.
	 * @param loadRep String A base folder to load after initialization is complete
	 * @param usersEnabled Boolean Whether users management is enabled or not
	 * @param loggedUser String Already logged user. 
	 */
	initialize: function(loadRep, usersEnabled, loggedUser)
	{	
		this._initLoadRep = loadRep;
		this.usersEnabled = usersEnabled;
		this._contextHolder = new AjxpDataModel();
		this._contextHolder.setAjxpNodeProvider(new RemoteNodeProvider());
        this.Registry = new Registry();
		this.appTitle = ajxpBootstrap.parameters.get("customWording").title || "Pydio";
        window.pydio = this;
	},
	
	/**
	 * Real initialisation sequence. Will Trigger the whole GUI building.
	 * Event ajaxplorer:loaded is fired at the end.
	 */
	init:function(){

        this.Controller = new ActionsManager(this.usersEnabled);
        this.UI = new PydioUI(this);

		document.observe("ajaxplorer:registry_loaded", function(){
            this.Registry.refreshExtensionsRegistry();
			this.Registry.logXmlUser(false);
            if(this.user){
                var repId = this.user.getActiveRepository();
                var repList = this.user.getRepositoriesList();
                var repositoryObject = repList.get(repId);
                if(repositoryObject) repositoryObject.loadResources();
            }
			if(this.UI.guiLoaded) {
				this.UI.refreshTemplateParts();
                this.Registry.refreshExtensionsRegistry();
			} else {
				document.observe("ajaxplorer:gui_loaded", function(){
					this.UI.refreshTemplateParts();
                    this.Registry.refreshExtensionsRegistry();
				}.bind(this));
			}
            this.loadActiveRepository();
            if(ajxpBootstrap.parameters.get("USER_GUI_ACTION")){
                var a= ajxpBootstrap.parameters.get("USER_GUI_ACTION");
                ajxpBootstrap.parameters.unset("USER_GUI_ACTION");
                var aBar = this.Controller;
                window.setTimeout(function(){
                    aBar.fireAction(a);
                }, 2000);
            }
		}.bind(this));

		modal.setLoadingStepCounts(5);
        if(ajxpBootstrap.parameters.get("PRELOADED_REGISTRY")){
            this.Registry.loadFromString(ajxpBootstrap.parameters.unset("PRELOADED_REGISTRY"));
            modal.updateLoadingProgress('XML Registry loaded');
        }else{
            this.loadXmlRegistry(true);
        }
		this.UI.initTemplates();
		modal.initForms();
        this.UI.initObjects();

        this.tryLogUserFromCookie();
        document.fire("ajaxplorer:registry_loaded", this.Registry.getXML());

        window.setTimeout(function(){
            document.fire('ajaxplorer:loaded');
        }, 200);

        this.initRouter();

	},

    initRouter : function(){

        if(!window.Backbone || !window.Backbone.Router) return;

        var WorkspaceRouter = Backbone.Router.extend({
            routes: {
                ":workspace/*path":"switchToWorkspace"
            },
            switchToWorkspace: function(workspace, path) {
                if(!ajaxplorer.user) {return;}
                if(path) path = '/' + path;
                else path = '/';
                var repos = ajaxplorer.user.getRepositoriesList();
                workspace = workspace.replace("ws-", "");
                var object = $H(repos).detect(function(pair){
                    return pair.value.getSlug() == workspace;
                });
                if(!object) return;
                var foundRepo = object.value;
                if(ajaxplorer.repositoryId != foundRepo.getId()){
                    if(path){
                        this._initLoadRep = path;
                    }
                    hideLightBox();
                    ajaxplorer.triggerRepositoryChange(foundRepo.getId());
                }else if(path){
                    window.setTimeout(function(){
                        hideLightBox();
                        ajaxplorer.goTo(path);
                    }, 1000);
                }
            }

        });

        this.router = new WorkspaceRouter();
        var appRoot = ajxpBootstrap.parameters.get('APPLICATION_ROOT');
        if(appRoot && appRoot != "/"){
            Backbone.history.start({
                pushState: true,
                root:appRoot
            });
        }else{
            Backbone.history.start({
                pushState: true
            });
        }
        var navigate = function(repList, repId){
            if(repId === false){
                this.router.navigate("/.");
            }else{
                var repositoryObject = repList.get(repId);
                if(repositoryObject){
                    var slug = repositoryObject.getSlug();
                    if(!repositoryObject.getAccessType().startsWith("ajxp_")){
                        slug = "ws-" + slug;
                    }
                    if(this._contextHolder && this._contextHolder.getContextNode()){
                        slug += this._contextHolder.getContextNode().getPath();
                    }
                    this.router.navigate(slug);
                }
            }
        }.bind(this);

        if(this.user){
            navigate(this.user.getRepositoriesList(), this.user.getActiveRepository());
        }
        document.observe("ajaxplorer:repository_list_refreshed", function(event){
            var repList = event.memo.list;
            var repId = event.memo.active;
            navigate(repList, repId);
        });
        document.observe("ajaxplorer:context_changed", function(event){
            if(!this.user) return;
            var repoList = this.user.getRepositoriesList();
            var activeRepo = repoList.get(this.user.getActiveRepository());
            if(activeRepo){
                var slug = activeRepo.getSlug();
                if(!activeRepo.getAccessType().startsWith("ajxp_")){
                    slug = "ws-" + slug;
                }
                var path = this.getContextNode().getPath();
                this.router.navigate(slug + path);
            }
        }.bind(this));
    },

	/**
	 * Loads the XML Registry, an image of the application in its current state
	 * sent by the server.
	 * @param sync Boolean Whether to send synchronously or not.
	 * @param xPath String An XPath to load only a subpart of the registry
	 */
	loadXmlRegistry : function(sync, xPath){
        this.Registry.load(sync, xPath);
	},

    /**
     * Get the XML Registry
     * @returns Document
     */
    getXmlRegistry : function(){
        return this.Registry.getXML();
    },

    /**
	 * Try reading the cookie and sending it to the server
	 */
	tryLogUserFromCookie : function(){
		var connexion = new Connexion();
		var rememberData = retrieveRememberData();
		if(rememberData!=null){
			connexion.addParameter('get_action', 'login');
			connexion.addParameter('userid', rememberData.user);
			connexion.addParameter('password', rememberData.pass);
			connexion.addParameter('cookie_login', 'true');
			connexion.onComplete = function(transport){
                hideLightBox();
                this.Controller.parseXmlMessage(transport.responseXML);
            }.bind(this);
			connexion.sendSync();
		}
	},

	/**
	 * Find the current repository (from the current user) and load it. 
	 */
	loadActiveRepository : function(){
		var repositoryObject = new Repository(null);
		if(this.user != null)
		{
            var repId = this.user.getActiveRepository();
			var repList = this.user.getRepositoriesList();			
			repositoryObject = repList.get(repId);
			if(!repositoryObject){
                if(this.user.lock){
                    this.Controller.loadActionsFromRegistry(this.getXmlRegistry());
                    window.setTimeout(function(){
                        this.Controller.fireAction(this.user.lock);
                    }.bind(this), 50);
                    return;
                }
                alert("No active repository found for user!");
			}
			if(this.user.getPreference("pending_folder") && this.user.getPreference("pending_folder") != "-1"){
				this._initLoadRep = this.user.getPreference("pending_folder");
				this.user.setPreference("pending_folder", "-1");
				this.user.savePreference("pending_folder");
			}else if(this.user.getPreference("ls_history", true)){
				var data = new Hash(this.user.getPreference("ls_history", true));
				this._initLoadRep = data.get(repId);
			}
		}
		this.loadRepository(repositoryObject);		
		if(repList && repId){
			document.fire("ajaxplorer:repository_list_refreshed", {list:repList,active:repId});
		}else{
			document.fire("ajaxplorer:repository_list_refreshed", {list:false,active:false});
		}
	},
	
	/**
	 * Refresh the repositories list for the current user
	 */
	reloadRepositoriesList : function(){
		if(!this.user) return;
		document.observeOnce("ajaxplorer:registry_part_loaded", function(event){
			if(event.memo != "user/repositories") return;
			this.Registry.logXmlUser(true);
			document.fire("ajaxplorer:repository_list_refreshed", {
                list:this.user.getRepositoriesList(),
                active:this.user.getActiveRepository()});
		}.bind(this));
		this.loadXmlRegistry(false, "user/repositories");
	},
	
	/**
	 * Load a Repository instance
	 * @param repository Repository
	 */
	loadRepository: function(repository){
		
		if(this.repositoryId != null && this.repositoryId == repository.getId()){
			//return;
		}
        this._contextHolder.setSelectedNodes([]);
        if(repository == null) return;
		
		repository.loadResources();
		var repositoryId = repository.getId();		
		var	newIcon = repository.getIcon(); 
				
		this.skipLsHistory = true;
		
		var providerDef = repository.getNodeProviderDef();
        var rootNode;
		if(providerDef != null){
			var provider = eval('new '+providerDef.name+'()');
			if(providerDef.options){
				provider.initProvider(providerDef.options);
			}
			this._contextHolder.setAjxpNodeProvider(provider);
			rootNode = new AjxpNode("/", false, repository.getLabel(), newIcon, provider);
		}else{
			rootNode = new AjxpNode("/", false, repository.getLabel(), newIcon);
			// Default
			this._contextHolder.setAjxpNodeProvider(new RemoteNodeProvider());
		}
		this._contextHolder.setRootNode(rootNode);
		this.repositoryId = repositoryId;
		
		/*
		if(this._initObj) { 
			rootNode.load();
			this._initObj = null ;
		}
		*/
		
		if(this._initLoadRep){
			if(this._initLoadRep != "" && this._initLoadRep != "/"){
				var copy = this._initLoadRep.valueOf();
				this._initLoadRep = null;
				rootNode.observeOnce("first_load", function(){
						setTimeout(function(){
                            this.goTo(copy);
                            this.skipLsHistory = false;
						}.bind(this), 1000);
				}.bind(this));
			}else{
				this.skipLsHistory = false;
			}
		}else{
			this.skipLsHistory = false;
		}
		
		rootNode.load();
	},

	/**
	 * Require a context change to the given path
	 * @param nodeOrPath AjxpNode|String A node or a path
	 */
	goTo: function(nodeOrPath){
        var path;
		if(Object.isString(nodeOrPath)){
			path = nodeOrPath
		}else{
			path = nodeOrPath.getPath();
            if(nodeOrPath.getMetadata().get("repository_id") != undefined && nodeOrPath.getMetadata().get("repository_id") != this.repositoryId
                && nodeOrPath.getAjxpMime() != "repository" && nodeOrPath.getAjxpMime() != "repository_editable"){
                if(ajaxplorer.user){
                    ajaxplorer.user.setPreference("pending_folder", nodeOrPath.getPath());
                }
                this.triggerRepositoryChange(nodeOrPath.getMetadata().get("repository_id"));
                return;
            }
		}

        var current = this._contextHolder.getContextNode();
        if(current && current.getPath() == path){
            return;
        }
        var gotoNode;
        if(path == "" || path == "/") {
            gotoNode = new AjxpNode("/");
            this._contextHolder.requireContextChange(gotoNode);
            return;
        }
        window.setTimeout(function(){
            this._contextHolder.loadPathInfoSync(path, function(foundNode){
                if(foundNode.isLeaf() && foundNode.getAjxpMime()!='ajxp_browsable_archive') {
                    this._contextHolder.setPendingSelection(getBaseName(path));
                    gotoNode = new AjxpNode(getRepName(path));
                }else{
                    gotoNode = foundNode;
                }
            }.bind(this));
    		this._contextHolder.requireContextChange(gotoNode);

        }.bind(this), 0);
	},
	
	/**
	 * Change the repository of the current user and reload list and current.
	 * @param repositoryId String Id of the new repository
	 */
	triggerRepositoryChange: function(repositoryId){		
		document.fire("ajaxplorer:trigger_repository_switch");
		var connexion = new Connexion();
		connexion.addParameter('get_action', 'switch_repository');
		connexion.addParameter('repository_id', repositoryId);
		connexion.onComplete = function(transport){
            this.Controller.parseXmlMessage(transport.responseXML);
            this.repositoryId = null;
            this.loadXmlRegistry();
		}.bind(this);
		var root = this._contextHolder.getRootNode();
		if(root){
			this.skipLsHistory = true;
			root.clear();			
		}
		connexion.sendAsync();
	},

	getPluginConfigs : function(pluginQuery){
        return this.Registry.getPluginConfigs(pluginQuery);
	},

    /**
     * Reload all messages from server and trigger updateI18nTags
     * @param newLanguage String
     */
	loadI18NMessages: function(newLanguage){
		var connexion = new Connexion();
		connexion.addParameter('get_action', 'get_i18n_messages');
		connexion.addParameter('lang', newLanguage);
		connexion.onComplete = function(transport){
			if(transport.responseText){
				var result = transport.responseText.evalScripts();
				window.MessageHash = result[0];
				for(var key in window.MessageHash){
                    if(window.MessageHash.hasOwnProperty(key)){
                        window.MessageHash[key] = window.MessageHash[key].replace("\\n", "\n");
                    }
				}
				this.UI.updateI18nTags();
                this.Controller.refreshGuiActionsI18n();

                this.loadXmlRegistry();
                this.fireContextRefresh();
                this.currentLanguage = newLanguage;
            }
		}.bind(this);
		connexion.sendSync();
	},

	/**
	 * Trigger a captcha image
	 * @param seedInputField HTMLInput The seed value
	 * @param existingCaptcha HTMLImage An image (optional)
	 * @param captchaAnchor HTMLElement Where to insert the image if created.
	 * @param captchaPosition String Position.insert() possible key.
	 */
	loadSeedOrCaptcha : function(seedInputField, existingCaptcha, captchaAnchor, captchaPosition){
		var connexion = new Connexion();
		connexion.addParameter("get_action", "get_seed");
		connexion.onComplete = function(transport){
			if(transport.responseJSON){
				seedInputField.value = transport.responseJSON.seed;
				var src = window.ajxpServerAccessPath + '&get_action=get_captcha&sid='+Math.random();
				var refreshSrc = ajxpResourcesFolder + '/images/actions/16/reload.png';
				if(existingCaptcha){
					existingCaptcha.src = src;
				}else{
					var insert = {};
					var string = '<div class="main_captcha_div" style="padding-top: 4px;"><div class="dialogLegend" ajxp_message_id="389">'+MessageHash[389]+'</div>';
					string += '<div class="captcha_container"><img id="captcha_image" align="top" src="'+src+'" width="170" height="80"><img align="top" style="cursor:pointer;" id="captcha_refresh" src="'+refreshSrc+'" with="16" height="16"></div>';
					string += '<div class="SF_element">';
					string += '		<div class="SF_label" ajxp_message_id="390">'+MessageHash[390]+'</div> <div class="SF_input"><input type="text" class="dialogFocus dialogEnterKey" style="width: 100px; padding: 0px;" name="captcha_code"></div>';
					string += '</div>';
					string += '<div style="clear:left;margin-bottom:7px;"></div></div>';
					insert[captchaPosition] = string;
					captchaAnchor.insert(insert);
					modal.refreshDialogPosition();
					modal.refreshDialogAppearance();
					$('captcha_refresh').observe('click', function(){
						$('captcha_image').src = window.ajxpServerAccessPath + '&get_action=get_captcha&sid='+Math.random();
					});
				}
			}else{
				seedInputField.value = transport.responseText;
				if(existingCaptcha){
					existingCaptcha.up('.main_captcha_div').remove();
					modal.refreshDialogPosition();
					modal.refreshDialogAppearance();
				}
			}
		};
		connexion.sendSync();		
	},


    /**
     * Get the main controller
     * @returns ActionManager
     */
    getController: function(){
        return this.Controller;
    },

    /**
     * Display an information or error message to the user
     * @param messageType String ERROR or SUCCESS
     * @param message String the message
     */
    displayMessage: function(messageType, message){
        var urls = parseUrl(message);
        if(urls.length && this.user && this.user.repositories){
            urls.each(function(match){
                var repo = this.user.repositories.get(match.host);
                if(!repo) return;
                message = message.replace(match.url, repo.label+":" + match.path + match.file);
            }.bind(this));
        }
        modal.displayMessage(messageType, message);
    },


    /*************************************************
     *
     *          PROXY METHODS FOR DATAMODEL
     *
     ************************************************/

	/**
	 * Accessor for updating the datamodel context
	 * @param ajxpContextNode AjxpNode
	 * @param ajxpSelectedNodes AjxpNode[]
	 * @param selectionSource String
	 */
	updateContextData : function(ajxpContextNode, ajxpSelectedNodes, selectionSource){
		if(ajxpContextNode){
			this._contextHolder.requireContextChange(ajxpContextNode);
		}
		if(ajxpSelectedNodes){
			this._contextHolder.setSelectedNodes(ajxpSelectedNodes, selectionSource);
		}
	},
	
	/**
	 * @returns AjxpDataModel
	 */
	getContextHolder : function(){
		return this._contextHolder;
	},
	
	/**
	 * @returns AjxpNode
	 */
	getContextNode : function(){
		return this._contextHolder.getContextNode() || new AjxpNode("");
	},
	
	/**
	 * @returns AjxpDataModel
	 */
	getUserSelection : function(){
		return this._contextHolder;
	},		
	
	/**
	 * Accessor for datamodel.requireContextChange()
	 */
	fireContextRefresh : function(){
		this.getContextHolder().requireContextChange(this.getContextNode(), true);
	},
	
	/**
	 * Accessor for datamodel.requireContextChange()
	 */
	fireNodeRefresh : function(nodePathOrNode, completeCallback){
		this.getContextHolder().requireNodeReload(nodePathOrNode, completeCallback);
	},
	
	/**
	 * Accessor for datamodel.requireContextChange()
	 */
	fireContextUp : function(){
		if(this.getContextNode().isRoot()) return;
		this.updateContextData(this.getContextNode().getParent());
	}


});
