/*
 Copyright 2022 Esri

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

const reactiveUtils = await $arcgis.import("esri/core/reactiveUtils");

import AppBase from "./support/AppBase.js";
import AppLoader from "./loaders/AppLoader.js";
import ViewLoading from './apl/ViewLoading.js';
import MapScale from './apl/MapScale.js';

/**
 *
 * TNC
 * https://www.maps.tnc.org/dangermond-historical-imagery/
 *
 * GeoXC
 * https://geoxc-apps.bd.esri.com/DangermondPreserve/HistoricalImagery/index.html
 *
 */

class Application extends AppBase {

  // PORTAL //
  portal;

  constructor() {
    super();

    // LOAD APPLICATION BASE //
    super.load().then(() => {

      // APPLICATION LOADER //
      const applicationLoader = new AppLoader({app: this});
      applicationLoader.load().then(({portal, group, map, view}) => {
        //console.info(portal, group, map, view);

        // PORTAL //
        this.portal = portal;

        // SET APPLICATION DETAILS //
        this.setApplicationDetails({map, group});

        // STARTUP DIALOG //
        this.initializeStartupDialog();

        // VIEW SHAREABLE URL PARAMETERS //
        this.initializeViewShareable({view});

        // APPLICATION //
        this.applicationReady({portal, group, map, view}).catch(this.displayError).then(() => {
          // HIDE APP LOADER //
          document.getElementById('app-loader').toggleAttribute('hidden', true);
          //console.info("Application ready...");
        });

      }).catch(this.displayError);
    }).catch(this.displayError);

  }

  /**
   *
   * @param view
   */
  configView({view}) {
    return new Promise(async (resolve, reject) => {
      if (view) {

        // VIEW AND POPUP //
        const Popup = await $arcgis.import("esri/widgets/Popup");
        view.set({
          constraints: {snapToZoom: false},
          scale: 100000,
          center: [-120.42881160136194, 34.50822647375175],
          popup: new Popup({
            dockEnabled: true,
            dockOptions: {
              buttonEnabled: false,
              breakpoint: false,
              position: "top-right"
            }
          })
        });
        // reactiveUtils.watch(() => view.center, center => {
        //   console.info(`[${ center.longitude },${ center.latitude }]`);
        // });

        // HOME //
        const Home = await $arcgis.import("esri/widgets/Home");
        const home = new Home({view});
        view.ui.add(home, {position: 'top-left', index: 0});

        // COMPASS //
        const Compass = await $arcgis.import("esri/widgets/Compass");
        const compass = new Compass({view: view});
        view.ui.add(compass, {position: 'top-left', index: 2});
        reactiveUtils.watch(() => view.rotation, rotation => {
          compass.set({visible: (rotation > 0)});
        }, {initial: true});

        // MAP SCALE //
        const mapScale = new MapScale({view});
        view.ui.add(mapScale, {position: 'bottom-left', index: 0});

        // VIEW LOADING INDICATOR //
        const viewLoading = new ViewLoading({view: view});
        view.ui.add(viewLoading, 'bottom-right');

        resolve();

      } else { resolve(); }
    });
  }

  /**
   *
   * @param portal
   * @param group
   * @param map
   * @param view
   * @returns {Promise}
   */
  applicationReady({portal, group, map, view}) {
    return new Promise(async (resolve, reject) => {
      // VIEW READY //
      this.configView({view}).then(async () => {
        //console.info(`https://www.arcgis.com/apps/mapviewer/index.html?webmap=${ view.map.portalItem.id }`);

        await this.initializeOverviewMap({view});
        await this.initializeImageryLayerList({view});

        resolve();
      }).catch(reject);
    });
  }

  /**
   *
   * @param view
   */
  async initializeOverviewMap({view}) {

    const MapView = await $arcgis.import("esri/views/MapView");
    const EsriMap = await $arcgis.import("esri/Map");
    const Graphic = await $arcgis.import("esri/Graphic");
    const GraphicsLayer = await $arcgis.import("esri/layers/GraphicsLayer");
    const Polygon = await $arcgis.import("esri/geometry/Polygon");
    const geometryEngine = await $arcgis.import("esri/geometry/geometryEngine");

    const overviewView = new MapView({
      container: "overview-map-container",
      map: new EsriMap({basemap: "hybrid"}),
      constraints: {snapToZoom: false},
      extent: view.extent.clone().expand(1.5),
      ui: {components: []}
    });
    return overviewView.when(() => {

      const mapExtentGraphic = new Graphic({
        geometry: view.extent.clone(),
        symbol: {
          type: "simple-fill",
          color: 'transparent',
          outline: {
            type: "simple-line",
            color: 'white',
            width: 1.5,
            style: "dash"
          }
        }
      });
      const footprintGraphic = new Graphic({
        symbol: {
          type: "simple-fill",
          color: 'transparent',
          outline: {
            type: "simple-line",
            color: 'white',
            width: 1.0
          }
        }
      });
      const currentFootprintGraphic = new Graphic({
        symbol: {
          type: "simple-fill",
          color: 'transparent',
          outline: {
            type: "simple-line",
            color: 'lime',
            width: 1.5
          }
        }
      });

      const footprintLayer = new GraphicsLayer({
        title: "Footprints",
        graphics: [mapExtentGraphic, footprintGraphic, currentFootprintGraphic]
      });
      overviewView.map.add(footprintLayer);

      const maskGraphic = new Graphic({
        symbol: {
          type: "simple-fill",
          color: 'rgba(255,255,255,0.5)',
          outline: {
            type: "simple-line",
            color: 'white',
            width: 0.5
          }
        }
      });
      const maskLayer = new GraphicsLayer({title: "Mask", graphics: [maskGraphic]});
      view.map.add(maskLayer);

      this.updateCurrentFootprint = (geometry) => {
        currentFootprintGraphic.geometry = geometry;
      };
      this.updateFootprint = (geometry) => {
        footprintGraphic.geometry = geometry;
      };

      const _polylineToPolygon = polyline => {
        return new Polygon({
          spatialReference: polyline.spatialReference,
          rings: polyline.paths
        });
      };

      /**
       *  INITIALIZE MASK GRAPHIC
       *  INITIALIZE VIEW EXTENT EVENTS
       *
       * @return {Promise<>}
       */
      this.initializeViewExtentEvents = async () => {

        const boundaryLayer = view.map.layers.find(layer => { return (layer.title === "Preserve Boundary"); });
        boundaryLayer.load().then(() => {
          boundaryLayer.set({effect: 'drop-shadow(2px,1px,1px,#242424)'});

          boundaryLayer.queryFeatures().then(featureSet => {

            let boundaryGeometry = featureSet.features[0].geometry;
            if (boundaryGeometry.type === 'polyline') {
              boundaryGeometry = _polylineToPolygon(boundaryGeometry);
            }
            const _boundaryPolygon = geometryEngine.geodesicBuffer(boundaryGeometry, 750.0, "meters");

            mapExtentGraphic.geometry = view.extent.clone();
            maskGraphic.geometry = geometryEngine.difference(mapExtentGraphic.geometry.extent.clone().expand(20.0), _boundaryPolygon);

            // DISABLE IMAGERY LAYER ITEMS THAT DON'T INTERSECT CURRENT VIEW EXTENT //
            reactiveUtils.watch(() => view.extent, (extent) => {
              mapExtentGraphic.geometry = view.extent.clone();
              this.disableExtentIntersect(extent);
            }, {initial: true});

          });
        });
      };

    });

  }

  /**
   *
   * @param view
   * @return {Promise<{imageryFootprintsLayer: *, imageryLayers: *[]}>}
   */
  async initializeImageryLayerList({view}) {

    const imageryLayers = view.map.layers.filter(l => l.title.startsWith('Preserve - '));
    await Promise.all(imageryLayers.map(imageryLayer => imageryLayer.load()));

    const _getImageryLayerYear = (layer) => {
      return Number(layer.title.split(' - ').at(1).trim());
    };

    const imageryLayerByYear = new Map();
    imageryLayers.forEach(imageryLayer => {
      const year = _getImageryLayerYear(imageryLayer);
      imageryLayerByYear.set(year, imageryLayer);
    });

    this.displayCurrentImagery = year => {
      imageryLayers.forEach(imageryLayer => {
        imageryLayer.visible = (_getImageryLayerYear(imageryLayer) === year);
      });
    };

    this.findImageryLayerByYear = year => {
      return imageryLayerByYear.get(year);
    };

    this.findVisibleImageryLayer = () => {
      return imageryLayers.find(imageryLayer => imageryLayer.visible);
    };

    this.setImageryLayerOpacity = opacity => {
      imageryLayers.forEach(layer => {
        layer.opacity = opacity;
      });
    };

    const layerDetailsModal = document.getElementById('layer-details-modal');
    const modalHeader = layerDetailsModal.querySelector('[slot="header"]');
    const modalContent = layerDetailsModal.querySelector('[slot="content"]');

    /**
     * DISPLAY LAYER DETAILS
     *
     * @param year
     */
    this.displayLayerDetails = year => {
      const imageryLayer = this.findImageryLayerByYear(year);
      const portalItem = imageryLayer.portalItem;
      if (portalItem) {
        modalHeader.innerHTML = `Jack & Laura Dangermond ${ imageryLayer.title }`;
        modalContent.innerHTML = portalItem.description;
        layerDetailsModal.open = true;
      } else {
        console.error("Can't find Layer PortalItem for year: ", year);
      }
    };

    // IMAGERY FOOTPRINTS LAYER //
    const imageryFootprintsLayer = view.map.layers.find(l => l.title === 'Imagery Footprints');
    await imageryFootprintsLayer.load();
    imageryFootprintsLayer.set({visible: false});

    // FOOTPRINTS QUERY //
    const footprintsQuery = imageryFootprintsLayer.createQuery();
    footprintsQuery.set({
      where: '(1=1)',
      returnGeometry: true,
      outFields: ['Name', 'Year', 'PercentCov', 'ColorType'],
      orderByFields: ['Year ASC']
    });

    // QUERY FOOTPRINT FEATURES //
    const {features: footprintFeatures} = await imageryFootprintsLayer.queryFeatures(footprintsQuery);

    // IMAGERY FEATURE BY YEAR //
    const featureByYear = new Map();

    // IMAGERY LAYER ITEM TEMPLATE //
    const layerItemTemplate = document.getElementById('layer-item-template');

    // CREATE IMAGERY LAYER ITEM //
    const imageryLayerItems = footprintFeatures.map((feature, featureIdx) => {
      // FOOTPRINT ATTRIBUTES //
      const {geometry: imageryFootprint, attributes: {Name, Year, PercentCov, ColorType}} = feature;

      featureByYear.set(Year, feature);

      const templateContent = layerItemTemplate.content.cloneNode(true);
      const imageryLayerItem = templateContent.querySelector('calcite-list-item');
      imageryLayerItem.setAttribute('value', Year);
      imageryLayerItem.setAttribute('label', Year);
      imageryLayerItem.setAttribute('description', ColorType.toLowerCase());
      imageryLayerItem.toggleAttribute('selected', !featureIdx);

      // COVERAGE METER
      const meter = templateContent.querySelector('calcite-meter');
      meter.setAttribute('value', PercentCov);

      // INFO ACTION = OPEN DIALOG WITH LAYER DETAILS //
      const infoAction = templateContent.querySelector('calcite-action');
      infoAction.setAttribute('title', Name);
      infoAction.addEventListener('click', (clickEvt) => {
        clickEvt.stopPropagation();
        this.displayLayerDetails(Year);
      });

      // ITEM HOVER INTERACTIONS //
      imageryLayerItem.addEventListener('pointerenter', () => {
        this.updateFootprint(imageryFootprint.clone());
      });
      imageryLayerItem.addEventListener('pointerleave', () => {
        this.updateFootprint();
      });

      return imageryLayerItem;
    });

    const selectImageryLayerByYear = (year) => {
      const imageryFootprintFeature = featureByYear.get(year);
      this.displayCurrentImagery(year);
      this.updateCurrentFootprint(imageryFootprintFeature.geometry.clone());
    };

    // ADD IMAGERY LAYER ITEMS TO LIST //
    const imageryLayersList = document.getElementById('layers-list-container');
    imageryLayersList.replaceChildren(...imageryLayerItems);
    imageryLayersList.addEventListener('calciteListChange', () => {
      const [selectedItem] = imageryLayersList.selectedItems;
      selectImageryLayerByYear(Number(selectedItem.value));
    });

    // UPDATE IMAGERY LAYER ITEM STYLE //
    imageryLayersList.querySelectorAll('calcite-list-item').forEach((item) => {
      this.setShadowElementStyle(item, '.label', 'font-size', '25pt');
      this.setShadowElementStyle(item, '.description', 'font-size', '11pt');
      this.setShadowElementStyle(item, '.description', 'margin-left', '0.8rem');
    });

    // SELECT INITIAL //
    const [firstFootprintFeature] = footprintFeatures;
    selectImageryLayerByYear(firstFootprintFeature.attributes.Year);

    // DISABLE IMAGERY LAYER ITEM BASED ON CURRENT EXTENT AND FOOTPRINT //
    const layerInExtentChip = document.getElementById('layer-in-extent-chip');
    this.disableExtentIntersect = (extent) => {

      // CALCULATE COUNT OF IMAGERY LAYERS IN CURRENT VIEW EXTENT //
      const validCount = imageryLayerItems.reduce((count, imageryLayerItem) => {
        const imageryFeature = featureByYear.get(Number(imageryLayerItem.value));
        const intersects = (imageryFeature && extent.intersects(imageryFeature.geometry));
        imageryLayerItem.toggleAttribute("disabled", !intersects);
        intersects && count++;
        return count;
      }, 0);

      // DISPLAY COUNT OF IMAGERY LAYERS IN CURRENT VIEW EXTENT //
      layerInExtentChip.innerHTML = `${ validCount } of ${ imageryLayerItems.length }`;
    };

    await this.initializeViewExtentEvents();

    await this.initializeMapActions({view, imageryLayers});

  }

  /**
   *
   * @param view
   * @param imageryLayers
   * @return {Promise<void>}
   */
  async initializeMapActions({view, imageryLayers}) {

    const mapActionPad = document.getElementById('map-action-pad');
    view.ui.add(mapActionPad, 'top-right');
    mapActionPad.toggleAttribute('hidden', false);

    await this.initializeLayerOpacity(view, imageryLayers);
    await this.initializeZoomWindow(view);
    await this.initializeLayerFadeTool(view);
    await this.initializePrint(view);

  }

  /**
   *
   * @param view
   * @param imageryLayers
   */
  async initializeLayerOpacity(view, imageryLayers) {

    const layerOpacitySlider = document.getElementById("layer-opacity-slider");
    layerOpacitySlider.addEventListener("calciteSliderInput", () => {
      imageryLayers.forEach(layer => {
        layer.opacity = Number(layerOpacitySlider.value);
      });
    });

    imageryLayers.forEach(layer => {
      reactiveUtils.watch(() => layer.opacity, opacity => {
        layerOpacitySlider.value = opacity;
      });
    });

  }

  /**
   *
   * @param view
   */
  async initializeZoomWindow(view) {

    // ZOOM WINDOW ENABLED //
    let zoomWindowEnabled = false;

    // ZOOM WINDOW BUTTON //
    const zoomWindowAction = document.getElementById('zoom-window-action');

    this.enableZoomWindowTool = (enabled) => {
      zoomWindowEnabled = zoomWindowAction.toggleAttribute("active", enabled);
      zoomWindowAction.toggleAttribute("indicator", zoomWindowEnabled);
      view.container.style.cursor = zoomWindowEnabled ? "all-scroll" : "default";
    };

    zoomWindowAction.addEventListener('click', () => {
      this.enableLayerFadeTool(false);
      this.enableZoomWindowTool(!zoomWindowAction.hasAttribute("active"));
    });

    // CONTAINER //
    const zoomContainer = document.createElement("div");
    zoomContainer.classList.add('zoom-view-node');
    zoomContainer.toggleAttribute('hidden', true);
    view.ui.add(zoomContainer);

    // CALC WINDOW POSITION //
    const windowOffset = 12;
    const zoomWindowPosition = (posEvt) => {
      const topOffset = (posEvt.y < (view.height - 250)) ? windowOffset : -200 - windowOffset;
      const leftOffset = (posEvt.x < (view.width - 250)) ? windowOffset : -200 - windowOffset;
      zoomContainer.style.setProperty('top', `${ (posEvt.y + topOffset) }px`);
      zoomContainer.style.setProperty('left', `${ (posEvt.x + leftOffset) }px`);
    };

    // DISPLAY ZOOM WINDOW //
    const displayZoomWindow = (positionEvt) => {
      zoomContainer.toggleAttribute('hidden', !positionEvt);
      positionEvt && zoomWindowPosition(positionEvt);
    };

    // MAP VIEW //
    const MapView = await $arcgis.import("esri/views/MapView");
    const zoomView = new MapView({
      container: zoomContainer,
      ui: {components: []},
      map: view.map
    });

    // IS WITHIN VIEW //
    const isWithinView = (evt) => {
      return (evt.x > 0) && (evt.x < view.width) && (evt.y > 0) && (evt.y < view.height);
    };

    // ZOOM LEVEL OFFSET //
    const zoomLevelOffset = 4;
    // LAST EVENT //
    let lastEvt = null;

    // UPDATE ZOOM WINDOW //
    const updateZoomWindow = async (viewEvt) => {
      if (isWithinView(viewEvt)) {
        const mapPoint = view.toMap(viewEvt);
        if (mapPoint) {
          lastEvt = viewEvt;

          // DISPLAY ZOOM WINDOW //
          displayZoomWindow(viewEvt);

          // GOTO //
          await zoomView.when();
          zoomView.goTo({
            target: mapPoint,
            zoom: (view.zoom + zoomLevelOffset)
          }, {animate: false});

        } else {
          // IN 3D IF NOT ON GLOBE //
          displayZoomWindow();
          lastEvt = null;
        }
      } else {
        // NOT WITHIN VIEW //
        displayZoomWindow();
        lastEvt = null;
      }
    };

    // POINTER DOWN //
    reactiveUtils.on(() => view, "pointer-down", (pointerDownEvt) => {
      if (zoomWindowEnabled) {
        pointerDownEvt.stopPropagation();
        if (pointerDownEvt.button === 0) {
          updateZoomWindow(pointerDownEvt);
        }
      }
    });

    // DRAG //
    reactiveUtils.on(() => view, "drag", (dragEvt) => {
      if (zoomWindowEnabled) {
        dragEvt.stopPropagation();
        switch (dragEvt.action) {
          case "update":
            updateZoomWindow(dragEvt);
            break;
          default:
            lastEvt = null;
        }
      }
    });

    // POINTER UP //
    reactiveUtils.on(() => view, "pointer-up", () => {
      if (zoomWindowEnabled) {
        displayZoomWindow();
        lastEvt = null;
      }
    });
    // POINTER LEAVE //
    reactiveUtils.on(() => view, "pointer-leave", () => {
      if (zoomWindowEnabled) {
        displayZoomWindow();
        lastEvt = null;
      }
    });

  }

  /**
   *
   * @param view
   */
  async initializeLayerFadeTool(view) {

    // FADE TOOL ENABLED //
    let layerFadeEnabled = false;

    // LAYER FADE BUTTON //
    const opacityFadeAction = document.getElementById('opacity-fade-action');

    this.enableLayerFadeTool = (enabled) => {
      layerFadeEnabled = opacityFadeAction.toggleAttribute("active", enabled);
      opacityFadeAction.toggleAttribute("indicator", layerFadeEnabled);
      view.container.style.cursor = layerFadeEnabled ? "pointer" : "default";
    };

    let fadeLayer;

    opacityFadeAction.addEventListener('click', () => {
      fadeLayer = this.findVisibleImageryLayer();
      this.enableZoomWindowTool(false);
      this.enableLayerFadeTool(!opacityFadeAction.hasAttribute("active"));
    });

    const fps = 30;
    let maxOpacity = 1.0;

    let fadeInHandle;
    const fadeIn = () => {
      if (fadeLayer) {
        fadeLayer.opacity += 0.01;
        if (fadeLayer.opacity < maxOpacity) {
          fadeInHandle = setTimeout(() => { fadeIn(); }, 1000 / fps);
        } else {
          this.setImageryLayerOpacity(fadeLayer.opacity);
          clearTimeout(fadeInHandle);
        }
      }
    };

    let fadeOutHandle;
    const fadeOut = () => {
      if (fadeLayer) {
        fadeLayer.opacity -= 0.01;
        if (fadeLayer.opacity > 0.0) {
          fadeOutHandle = setTimeout(() => { fadeOut(); }, 1000 / fps);
        } else {
          this.setImageryLayerOpacity(fadeLayer.opacity);
          clearTimeout(fadeOutHandle);
        }
      }
    };

    // POINTER DOWN //
    reactiveUtils.on(() => view, "hold", (holdEvt) => {
      if (layerFadeEnabled && fadeLayer) {
        holdEvt.stopPropagation();
        clearTimeout(fadeInHandle);
        maxOpacity = fadeLayer.opacity;
        fadeOut();
      }
    });

    // POINTER UP //
    reactiveUtils.on(() => view, "pointer-up", (pointerUpEvt) => {
      if (layerFadeEnabled) {
        pointerUpEvt.stopPropagation();
        clearTimeout(fadeOutHandle);
        fadeIn(maxOpacity);
      }
    });

  }

  /**
   *
   * @param view
   * @return {Promise<void>}
   */
  async initializePrint(view) {

    const printPanel = document.getElementById('print-panel');
    view.ui.add(printPanel, 'top-right');

    const printAction = document.getElementById('print-action');
    printAction.addEventListener('click', () => {
      const isActive = printAction.toggleAttribute('active');
      printAction.toggleAttribute('indicator', isActive);
      printPanel.toggleAttribute('hidden', !isActive);
    });

    // PRINT //
    const Print = await $arcgis.import("esri/widgets/Print");
    const print = new Print({
      container: 'print-container',
      view: view,
      printServiceUrl: this.portal.helperServices.printTask.url,
      templateOptions: {title: this.title, author: this.portal.user ? this.portal.user.fullName : ""}
    });

  }

}

export default new Application();
