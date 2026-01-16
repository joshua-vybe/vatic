import { render } from "solid-js/web"
import App from "./App"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/ibm-plex-mono/600.css"
import "@fontsource/ibm-plex-mono/700.css"
import "./index.css"

render(() => <App />, document.getElementById("root") as HTMLElement)
