// Cloudflare Pages advanced mode: canonical host, then the original static assets.
export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname === 'www.mawl.tech') {
      url.hostname = 'mawl.tech'
      url.protocol = 'https:'
      url.port = ''
      return Response.redirect(url.href, 301)
    }
    return env.ASSETS.fetch(request)
  },
}
