import { createRoot } from "react-dom/client";
import Interview from "../../app/src/pages/(app)/recommender/interview";
import Draft from "../../app/src/pages/(app)/recommender/draft";
const page = new URLSearchParams(location.search).get("page");
createRoot(document.getElementById("root")!).render(page === "draft" ? <Draft /> : <Interview />);
