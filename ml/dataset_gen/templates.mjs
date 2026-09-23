import { pick, randInt } from './rng.mjs';

function loginForm(rng) {
  return `
    <div class="card" style="max-width:400px;margin:40px auto;">
      <h1 data-uiclass="text_region">Sign in to your account</h1>
      <p data-uiclass="text_region">Enter your credentials below to continue.</p>
      <label>Email</label>
      <input type="email" data-uiclass="input_field" placeholder="you@example.com">
      <label>Password</label>
      <input type="password" data-uiclass="input_field" placeholder="********">
      <label><input type="checkbox" data-uiclass="checkbox"> Remember me</label>
      <button data-uiclass="button">Sign In</button><br><br>
      <a href="#" data-uiclass="link">Forgot password?</a>
    </div>`;
}

function searchPage(rng) {
  const queries = ['STEM scholarships', 'merit awards', 'grants for students', 'research fellowships'];
  return `
    <div style="max-width:600px;margin:30px auto;">
      <h1 data-uiclass="text_region">Search Scholarships</h1>
      <input type="text" data-uiclass="input_field" placeholder="Search ${pick(rng, queries)}...">
      <button data-uiclass="button">Search</button>
      <div class="card"><a href="#" data-uiclass="link">Merit-based Scholarship ${randInt(rng, 1, 9)}</a></div>
      <div class="card"><a href="#" data-uiclass="link">Need-based Grant ${randInt(rng, 1, 9)}</a></div>
      <div class="card"><a href="#" data-uiclass="link">Research Fellowship ${randInt(rng, 1, 9)}</a></div>
    </div>`;
}

function dashboard(rng) {
  return `
    <nav>
      <a href="#" data-uiclass="link">Home</a>
      <a href="#" data-uiclass="link">Reports</a>
      <a href="#" data-uiclass="link">Settings</a>
    </nav>
    <div style="padding:20px;">
      <h1 data-uiclass="text_region">Dashboard Overview</h1>
      <select data-uiclass="dropdown"><option>This week</option><option>This month</option></select>
      <button data-uiclass="button">Export</button>
      <span class="icon" data-uiclass="icon">&#9881;</span>
      <span class="icon" data-uiclass="icon">&#128276;</span>
      <div class="card"><p data-uiclass="text_region">Revenue is up ${randInt(rng, 2, 30)}% this month.</p></div>
      <div class="card"><p data-uiclass="text_region">${randInt(rng, 100, 999)} active users today.</p></div>
    </div>`;
}

function checkoutForm(rng) {
  return `
    <div class="card" style="max-width:480px;margin:30px auto;">
      <h1 data-uiclass="text_region">Checkout</h1>
      <label>Full name</label><input type="text" data-uiclass="input_field">
      <label>Address</label><input type="text" data-uiclass="input_field">
      <label>Country</label>
      <select data-uiclass="dropdown"><option>India</option><option>USA</option><option>UK</option></select>
      <p data-uiclass="text_region">Payment method</p>
      <label><input type="radio" name="pm" data-uiclass="radio"> Card</label>
      <label><input type="radio" name="pm" data-uiclass="radio"> UPI</label>
      <label><input type="checkbox" data-uiclass="checkbox"> I agree to the terms</label>
      <button data-uiclass="button">Place Order</button>
    </div>`;
}

function settingsForm(rng) {
  return `
    <div style="max-width:500px;margin:30px auto;">
      <h1 data-uiclass="text_region">Account Settings</h1>
      <label><input type="checkbox" data-uiclass="checkbox"> Email notifications</label>
      <label><input type="checkbox" data-uiclass="checkbox"> SMS alerts</label>
      <label>Language</label>
      <select data-uiclass="dropdown"><option>English</option><option>Hindi</option></select>
      <label>Display name</label>
      <input type="text" data-uiclass="input_field">
      <button data-uiclass="button">Save changes</button><br><br>
      <a href="#" data-uiclass="link">Delete account</a>
    </div>`;
}

function articlePage(rng) {
  const topics = ['Browser Agents', 'On-Device Perception', 'Privacy-Preserving AI', 'Web Automation'];
  return `
    <article style="max-width:640px;margin:30px auto;">
      <h1 data-uiclass="text_region">Understanding ${pick(rng, topics)}</h1>
      <div class="placeholder-img" data-uiclass="image" style="height:${randInt(rng, 150, 260)}px;">Cover image</div>
      <p data-uiclass="text_region">Long paragraph text goes here describing the topic in detail, covering background and motivation for the reader.</p>
      <p data-uiclass="text_region">Another paragraph continuing the discussion with further technical detail and examples.</p>
      <a href="#" data-uiclass="link">Read the full research paper</a>
    </article>`;
}

function blankPage(rng) {
  return `
    <div style="max-width:600px;margin:60px auto;text-align:center;">
      <p>This page intentionally has no interactive elements.</p>
      <p>It exists to teach the detector not to hallucinate detections on plain content.</p>
    </div>`;
}

function galleryPage(rng) {
  return `
    <div style="padding:20px;">
      <h1 data-uiclass="text_region">Photo Gallery</h1>
      <select data-uiclass="dropdown"><option>Newest</option><option>Popular</option></select>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;">
        <div class="placeholder-img" data-uiclass="image" style="width:140px;height:100px;">1</div>
        <div class="placeholder-img" data-uiclass="image" style="width:140px;height:100px;">2</div>
        <div class="placeholder-img" data-uiclass="image" style="width:140px;height:100px;">3</div>
        <div class="placeholder-img" data-uiclass="image" style="width:140px;height:100px;">4</div>
      </div>
      <br>
      <span class="icon" data-uiclass="icon">&#10084;</span>
      <span class="icon" data-uiclass="icon">&#128257;</span>
      <a href="#" data-uiclass="link">Next page</a>
      &nbsp;
      <a href="#" data-uiclass="link">Previous page</a>
    </div>`;
}

export const TEMPLATES = [
  { name: 'login_form', build: loginForm, split: 'train' },
  { name: 'search_page', build: searchPage, split: 'train' },
  { name: 'dashboard', build: dashboard, split: 'train' },
  { name: 'checkout_form', build: checkoutForm, split: 'train' },
  { name: 'article_page', build: articlePage, split: 'train' },
  { name: 'blank_page', build: blankPage, split: 'train' },
  { name: 'settings_form', build: settingsForm, split: 'val' },
  { name: 'gallery_page', build: galleryPage, split: 'val' },
];
