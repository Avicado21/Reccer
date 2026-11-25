import { createRoot } from "react-dom/client";
import Interview from "../../src/pages/(app)/(protected)/recommender/interview";
import Draft from "../../src/pages/(app)/(protected)/recommender/draft";
const page = new URLSearchParams(location.search).get("page");
createRoot(document.getElementById("root")!).render(page === "draft" ? <Draft /> : <Interview />);
