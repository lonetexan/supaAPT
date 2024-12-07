// map.js

let map;
let placesService;
let markers = [];
let infoWindow;
let apartmentsList;
let pagination = null;
let lastSearchCenter = null;
let lastZoomLevel = null;

const radiusInMeters = 16000; // about 10 miles

window.initMap = function() {
  let initialLat = parseFloat(sessionStorage.getItem('initialCenterLat')) || 30.2672;
  let initialLng = parseFloat(sessionStorage.getItem('initialCenterLng')) || -97.7431;

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: initialLat, lng: initialLng },
    zoom: 13,
    disableDefaultUI: false,
    gestureHandling: "greedy"
  });

  placesService = new google.maps.places.PlacesService(map);
  apartmentsList = document.getElementById('apartmentsList');
  infoWindow = new google.maps.InfoWindow();

  const input = document.getElementById('pac-input');
  const autocompleteOptions = {
    fields: ["geometry", "name"]
  };
  const autocomplete = new google.maps.places.Autocomplete(input, autocompleteOptions);
  autocomplete.bindTo('bounds', map);

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry || !place.geometry.location) return;
    map.setCenter(place.geometry.location);
    map.setZoom(13);
    maybeSearch();
  });

  map.addListener('idle', () => {
    maybeSearch();
  });

  maybeSearch();
};

function maybeSearch() {
  if (!map) return;

  const currentCenter = map.getCenter();
  const currentZoom = map.getZoom();

  if (currentZoom < 13) {
    clearApartmentsList();
    clearMarkers();
    return;
  }

  if (shouldSearchAgain(currentCenter, currentZoom)) {
    lastSearchCenter = currentCenter;
    lastZoomLevel = currentZoom;
    initialSearch(currentCenter);
  }
}

function shouldSearchAgain(center, zoom) {
  if (!lastSearchCenter || lastZoomLevel === null) return true;
  if (zoom !== lastZoomLevel) return true;

  const latDiff = Math.abs(center.lat() - lastSearchCenter.lat());
  const lngDiff = Math.abs(center.lng() - lastSearchCenter.lng());
  return (latDiff > 0.005 || lngDiff > 0.005);
}

function initialSearch(center) {
  clearApartmentsList();
  clearMarkers();

  const request = {
    location: center,
    radius: radiusInMeters,
    keyword: 'apartment OR condo OR student housing'
  };

  placesService.nearbySearch(request, handleSearchResults);
}

function handleSearchResults(results, status, pag) {
  if (status === google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
    displayApartments(results);
    pagination = pag;
    if (pagination && pagination.hasNextPage) {
      setTimeout(() => pagination.nextPage(), 2000);
    }
  } else {
    console.log("No apartments found in this area.");
    clearApartmentsList();
  }
}

function displayApartments(places) {
  places.forEach((place) => {
    const detailsRequest = {
      placeId: place.place_id,
      fields: [
        'name', 'photos', 'vicinity', 'website', 'geometry', 'place_id'
      ]
    };

    placesService.getDetails(detailsRequest, (details, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && details) {
        addApartmentMarker(details);
        addApartmentToList(details);
      } else {
        addApartmentMarker(place);
        addApartmentToList(place);
      }
    });
  });
}

function addApartmentMarker(details) {
  const marker = new google.maps.Marker({
    position: details.geometry.location,
    map: map,
    title: details.name
  });
  markers.push(marker);

  marker.addListener('click', () => {
    let contentString = `
      <div style="color:#000;">
        <h2>${details.name}</h2>
        <p><strong>Address:</strong> ${details.vicinity || 'N/A'}</p>
    `;

    if (details.website) {
      contentString += `<p><a href="${details.website}" target="_blank" rel="noopener">Website</a></p>`;
    }

    if (details.photos && details.photos.length > 0) {
      const photoUrl = details.photos[0].getUrl({ maxWidth: 300 });
      contentString += `
        <div style="margin-top: 10px;">
          <img src="${photoUrl}" alt="Apartment Photo" style="max-width:100%; height:auto; border-radius:5px;">
        </div>
      `;
    }

    contentString += `</div>`;

    infoWindow.setContent(contentString);
    infoWindow.open(map, marker);
  });

  return marker;
}

// Show error message in errorMessageContainer
function showError(message) {
  const errorContainer = document.getElementById('errorMessageContainer');
  errorContainer.textContent = message;
  errorContainer.style.display = 'block';

  // Hide the message after a few seconds
  setTimeout(() => {
    errorContainer.style.display = 'none';
  }, 3000);
}

function addApartmentToList(details) {
  const li = document.createElement('li');
  li.className = 'apartment-item';

  let photoHtml = '';
  let photoUrl = '';
  if (details.photos && details.photos.length > 0) {
    photoUrl = details.photos[0].getUrl({ maxWidth: 200 });
    photoHtml = `<img src="${photoUrl}" alt="${details.name}" />`;
  }

  let websiteHtml = '';
  if (details.website) {
    websiteHtml = `<a href="${details.website}" target="_blank">Visit Website</a><br>`;
  }

  li.innerHTML = `
    <strong>${details.name}</strong><br>
    ${details.vicinity || 'Address not available'}<br>
    ${photoHtml}
    ${websiteHtml}
  `;

  // Only show the "Save" button if logged in
  if (window.currentUser) {
    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save';
    saveBtn.addEventListener('click', () => {
      saveApartmentToSupabase({
        place_id: details.place_id,
        name: details.name,
        vicinity: details.vicinity,
        website: details.website || '',
        photo: photoUrl,
        rating: 0
      });
    });
    li.appendChild(saveBtn);
  } else {
    // User not logged in, show a prompt instead of a save button
    const loginPrompt = document.createElement('p');
    loginPrompt.style.color = 'red';
    loginPrompt.textContent = 'Please log in to save apartments.';
    li.appendChild(loginPrompt);
  }

  apartmentsList.appendChild(li);
}

function clearApartmentsList() {
  if (apartmentsList) {
    apartmentsList.innerHTML = '';
  }
}

function clearMarkers() {
  for (const marker of markers) {
    marker.setMap(null);
  }
  markers = [];
}

async function fetchSavedApartmentsFromSupabase() {
  if (!window.currentUser) return [];
  const { data, error } = await window.supabase
    .from('saved_apartments')
    .select('*')
    .eq('user_id', window.currentUser.id);

  if (error) {
    console.error("Error fetching saved apartments:", error);
    return [];
  }
  return data;
}

async function saveApartmentToSupabase(apartment) {
  if (!window.currentUser) {
    // If for some reason this is called when not logged in, show error
    showError("You must be logged in to save apartments.");
    return;
  }

  const { error } = await window.supabase
    .from('saved_apartments')
    .upsert({
      user_id: window.currentUser.id,
      place_id: apartment.place_id,
      name: apartment.name,
      vicinity: apartment.vicinity,
      website: apartment.website,
      photo_url: apartment.photo,
      rating: apartment.rating || 0
    }, { onConflict: 'user_id,place_id' });

  if (error) {
    console.error("Error saving apartment:", error);
    showError("Error saving apartment: " + error.message);
  } else {
    showError("Apartment saved successfully!");
  }
}

async function unsaveApartmentFromSupabase(place_id) {
  if (!window.currentUser) {
    showError("You must be logged in to remove saved apartments.");
    return;
  }

  const { error } = await window.supabase
    .from('saved_apartments')
    .delete()
    .eq('user_id', window.currentUser.id)
    .eq('place_id', place_id);

  if (error) {
    console.error("Error removing apartment:", error);
    showError("Error removing apartment: " + error.message);
  } else {
    displaySavedApartments();
  }
}

async function updateApartmentRatingInSupabase(place_id, rating) {
  if (!window.currentUser) {
    showError("You must be logged in to rate apartments.");
    return;
  }

  const { error } = await window.supabase
    .from('saved_apartments')
    .update({ rating })
    .eq('user_id', window.currentUser.id)
    .eq('place_id', place_id);

  if (error) {
    console.error("Error updating rating:", error);
    showError("Error updating rating: " + error.message);
  }
}

window.displaySavedApartments = async function() {
  const savedList = document.getElementById('savedApartmentsList');
  savedList.innerHTML = '';

  if (!window.currentUser) {
    savedList.innerHTML = '<p>Please log in to see your saved apartments.</p>';
    return;
  }

  const savedApartments = await fetchSavedApartmentsFromSupabase();
  if (savedApartments.length === 0) {
    savedList.innerHTML = '<p>No saved apartments yet.</p>';
    return;
  }

  savedApartments.forEach(apartment => {
    const li = document.createElement('li');
    li.className = 'saved-apartment-item';

    let photoHtml = apartment.photo_url ? `<img src="${apartment.photo_url}" alt="${apartment.name}" />` : '';
    let websiteHtml = apartment.website ? `<a href="${apartment.website}" target="_blank">Visit Website</a><br>` : '';

    li.innerHTML = `
      <strong>${apartment.name}</strong><br>
      ${apartment.vicinity || 'Address not available'}<br>
      ${photoHtml}
      ${websiteHtml}
    `;

    // Rating stars
    const ratingContainer = document.createElement('div');
    ratingContainer.style.margin = '10px 0';

    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('span');
      star.innerText = '★';
      star.style.cursor = 'pointer';
      star.style.fontSize = '20px';
      star.style.marginRight = '5px';
      star.style.color = i <= (apartment.rating || 0) ? 'gold' : '#ccc';

      star.addEventListener('mouseover', () => {
        highlightStars(ratingContainer, i);
      });

      star.addEventListener('mouseout', () => {
        highlightStars(ratingContainer, apartment.rating || 0);
      });

      star.addEventListener('click', () => {
        updateApartmentRatingInSupabase(apartment.place_id, i);
        apartment.rating = i;
        highlightStars(ratingContainer, i);
      });

      ratingContainer.appendChild(star);
    }

    li.appendChild(ratingContainer);

    // Unsave button
    const unsaveBtn = document.createElement('button');
    unsaveBtn.innerText = 'Unsave';
    unsaveBtn.addEventListener('click', () => unsaveApartmentFromSupabase(apartment.place_id));
    li.appendChild(unsaveBtn);

    savedList.appendChild(li);
  });
};

function highlightStars(container, rating) {
  const stars = container.querySelectorAll('span');
  stars.forEach((star, index) => {
    star.style.color = index < rating ? 'gold' : '#ccc';
  });
}
