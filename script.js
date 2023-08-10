const simplifyPolygon = (polygon, tolerance) => {
    const simplifiedPolygon = [];
    let lastPoint = polygon[0];
    let totalLat = 0, totalLng = 0;
    for (let i = 1; i < polygon.length; i++) {
        totalLat += polygon[i].lat;
        totalLng += polygon[i].lng;
        if (getDistance(lastPoint, polygon[i]) > tolerance) {
            simplifiedPolygon.push(polygon[i]);
            lastPoint = polygon[i];
        }
    }

    if (simplifiedPolygon.length > 0 && simplifiedPolygon.length < polygon.length)
        return simplifiedPolygon;
    return [polygon[0]];
};

const getDistance = (point1, point2) => {
    const [lat1, lng1] = [point1.lat, point1.lng];
    const [lat2, lng2] = [point2.lat, point2.lng];

    const radlat1 = Math.PI * lat1 / 180;
    const radlat2 = Math.PI * lat2 / 180;

    let dist =
        Math.sin(radlat1) * Math.sin(radlat2) +
        Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(Math.PI * (lng1 - lng2) / 180);

    dist = Math.acos(dist);
    dist *= 180 / Math.PI;
    dist *= 60 * 1.1515 * 1.609344;

    return dist;
};

const map = L.map('map').setView([37.16611, -119.44944], 6);
const sidebar = L.control.sidebar({
    autopan: true,
    container: 'sidebar',
    closeButton: true,
    position: 'right'
}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 6,
    maxZoom: 17,
    attribution: '© <a href="http://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
}).addTo(map);
const bottomCorners = document.getElementsByClassName('leaflet-bottom');
[bottomCorners[0].innerHTML, bottomCorners[1].innerHTML] = [bottomCorners[1].innerHTML, bottomCorners[0].innerHTML];

let largestColor = { r: 255, g: 0, b: 0 }, smallestColor = { r: 255, g: 255, b: 0 };
let fireLayer;
let yearLimit = new Date().getFullYear() - 25;
let fires = [];
const firesByYear = new Map();
for (let i = yearLimit; i < new Date().getFullYear(); i++)
    firesByYear.set(i.toString(), []);
const causes = [
    'lightning',
    'equipment use',
    'smoking',
    'a campfire',
    'debris',
    'railroad activity',
    'arson',
    'playing with fire',
    'miscellaneous activity',
    'a vehicle',
    'a powerline',
    'firefighter training',
    'non-firefighter training',
    'an unknown cause',
    'a structure fire',
    'aircraft',
    'volcanic activity',
    'an escaped prescribed burn',
];
fetch('https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/California_Fire_Perimeters/FeatureServer/0?f=json').then(res => res.json()).then(data => {
    for (const field of data.fields)
        if (field.name == 'UNIT_ID') {
            const unitSelect = document.getElementById('unit-select');
            const units = new Map(field.domain.codedValues.map(v => { unitSelect.innerHTML += `<option value="${v.code}">${v.name}</option>`; return [v.code, v.name.replace(' - ', '-')]; }));
            const urls = [];
            const getFires = (offset) => {
                fetch('https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Fire_Perimeters/FeatureServer/0/query?f=geojson&where=YEAR_ >= ' + yearLimit + '&orderByFields=YEAR_ DESC&outFields=CAUSE&returnGeometry=false&resultOffset=' + offset).then(res => res.json()).then(fireYears => {
                    urls.push('https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Fire_Perimeters/FeatureServer/0/query?f=geojson&where=YEAR_ >= ' + yearLimit + '&orderByFields=YEAR_ DESC&outFields=ALARM_DATE,CAUSE,CONT_DATE,FIRE_NAME,GIS_ACRES,UNIT_ID,YEAR_&resultOffset=' + offset);
                    if (fireYears.properties && fireYears.properties.exceededTransferLimit)
                        getFires(offset + fireYears.features.length);
                    else {
                        Promise.all(urls.map(async url => fetch(url).then(res => res.json()))).then(data => {
                            for (const datum of data)
                                for (const fire of datum.features)
                                    if (fire.properties.FIRE_NAME && fire.properties.GIS_ACRES && fire.properties.YEAR_) {
                                        for (let polygon of fire.geometry.coordinates) {
                                            if (fire.geometry.type == 'MultiPolygon')
                                                polygon = polygon[0];
                                            for (const point of polygon)
                                                [point[0], point[1]] = [point[1], point[0]];
                                        }
                                        const name = fire.properties.FIRE_NAME.toLowerCase().replaceAll('_', ' ').replaceAll(/( [a-z])|^([a-z])/g, letter => letter.toUpperCase()) + ' Fire';
                                        let days;
                                        if (fire.properties.CONT_DATE)
                                            days = Math.floor((new Date(fire.properties.CONT_DATE) - new Date(fire.properties.ALARM_DATE)) / 1000 / 60 / 60 / 24 + 1);
                                        if (!fire.properties.CAUSE)
                                            fire.properties.CAUSE = 14;
                                        else if (fire.properties.CAUSE == 19)
                                            fire.properties.CAUSE = 4;
                                        fire.properties.CAUSE--;
                                        const fireObject = {
                                            polygon: (L.polygon(fire.geometry.coordinates)).bindPopup(`
                                                <p><h2>${name} (${fire.properties.YEAR_})</h2></p>
                                                <p>
                                                    The ${name} started on ${new Date(fire.properties.ALARM_DATE).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} because of ${causes[fire.properties.CAUSE]}. 
                                                    It burned UNITS.
                                                    The fire was contained by ${units.get(fire.properties.UNIT_ID)}${days ? ' after ' + days + ' day' + (days > 1 ? 's' : '') : ''}.
                                                </p>
                                            `), properties: fire.properties
                                        };
                                        fires.push(fireObject);
                                        firesByYear.get(fire.properties.YEAR_).push(fireObject);
                                    }

                            fires = fires.sort((a, b) => b.properties.GIS_ACRES - a.properties.GIS_ACRES);
                            const yearSelect = document.getElementById('year-select');
                            const years = [...firesByYear.entries()].reverse();
                            for (const year of years) {
                                yearSelect.innerHTML += `<option value="${year[0]}">${year[0]}</option>`;
                                if (year[1] != fires[0].properties.YEAR_) {
                                    let largestSize = 0, largestFire;
                                    for (const fire of year[1])
                                        if (fire.properties.GIS_ACRES > largestSize) {
                                            largestSize = fire.properties.GIS_ACRES;
                                            largestFire = fire;
                                        }
                                    largestFire.polygon.setPopupContent(largestFire.polygon.getPopup().getContent().replace('UNITS', 'UNITS, making it the biggest fire of ' + year[0]));
                                }
                            }
                            fires[0].polygon.setPopupContent(fires[0].polygon.getPopup().getContent().replace('UNITS', 'UNITS, making it the biggest fire in California history'));

                            let tolerance = 0;
                            const causeChecks = document.querySelectorAll('#causes input');
                            for (const check of causeChecks)
                                check.onchange = () => showFires(true);
                            let unitMultiplier = 1, unitName = 'acres';
                            const largestColorSelect = document.getElementById('largest'), smallestColorSelect = document.getElementById('smallest');
                            document.getElementById('settings').onsubmit = e => {
                                unitName = e.target.querySelector('input[type=radio]:checked').value;
                                unitMultiplier = unitName == 'acres' ? 1 : unitName == 'square miles' ? 0.0015625 : 0.00404686;
                                largestColor = { r: parseInt(largestColorSelect.value.substring(1, 3), 16), g: parseInt(largestColorSelect.value.substring(3, 5), 16), b: parseInt(largestColorSelect.value.substring(5, 7), 16) };
                                smallestColor = { r: parseInt(smallestColorSelect.value.substring(1, 3), 16), g: parseInt(smallestColorSelect.value.substring(3, 5), 16), b: parseInt(smallestColorSelect.value.substring(5, 7), 16) };
                                showFires(true);
                                return false;
                            };
                            const fireCount = document.getElementById('fire-count');
                            const showFires = (reload = false) => {
                                const simplifiedFires = [];
                                const zoom = map.getZoom();
                                const newTolerance = 5 / 3 * Math.max(Math.floor(13 / 2 - zoom / 2), 0);
                                let allCauses = true;
                                for (const check of causeChecks)
                                    if (check.checked) {
                                        allCauses = false;
                                        break;
                                    }

                                if (tolerance != newTolerance || reload == true) {
                                    tolerance = newTolerance;
                                    for (const fire of fires)
                                        if ((yearSelect.value == 'all' || fire.properties.YEAR_ == yearSelect.value) && (unitSelect.value == 'all' || fire.properties.UNIT_ID == unitSelect.value) && (allCauses || causeChecks[fire.properties.CAUSE].checked)) {
                                            for (latlng of fire.polygon.getLatLngs())
                                                simplifiedFires.push(L.polygon(simplifyPolygon(latlng, tolerance)).bindPopup(fire.polygon.getPopup().getContent().replace('UNITS', (Math.round(fire.properties.GIS_ACRES * unitMultiplier * 100) / 100).toLocaleString() + ' ' + unitName)).setStyle(fire.polygon.options));
                                        }
                                    for (let i = 0; i < simplifiedFires.length; i++) {
                                        const color = `rgb(${(largestColor.r - smallestColor.r) * (simplifiedFires.length - 1 - i) / (simplifiedFires.length - 1) + smallestColor.r}, ${(largestColor.g - smallestColor.g) * (simplifiedFires.length - 1 - i) / (simplifiedFires.length - 1) + smallestColor.g}, ${(largestColor.b - smallestColor.b) * (simplifiedFires.length - 1 - i) / (simplifiedFires.length - 1) + smallestColor.b})`;
                                        simplifiedFires[i].setStyle({ color, fillColor: color, opacity: 1 });
                                    }

                                    if (fireLayer)
                                        map.removeLayer(fireLayer);
                                    fireLayer = L.layerGroup(simplifiedFires).addTo(map);
                                    fireCount.innerHTML = '(' + simplifiedFires.length.toLocaleString() + ')';
                                }
                            };
                            map.on('zoomend', showFires);
                            yearSelect.onchange = () => showFires(true);
                            unitSelect.onchange = () => showFires(true);
                            showFires();
                            document.getElementById('loading').style.opacity = '0';
                            setTimeout(() => {
                                document.getElementById('loading').style.display = 'none';
                            }, 1500);
                        });
                    }
                });
            };
            getFires(0);
        }
});

const sidebarContent = document.querySelector('.leaflet-sidebar-content'), scrollContents = document.getElementsByClassName('scroll-content');
new ResizeObserver(() => {
    for (const scrollContent of scrollContents)
        scrollContent.style.height = sidebarContent.clientHeight - 40 + 'px';
}).observe(sidebarContent);