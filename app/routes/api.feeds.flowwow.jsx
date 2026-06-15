import { promises as fs } from "fs";
import path from "path";

export const loader = async () => {
  try {
    const filePath = path.join(process.cwd(), "public", "feeds", "flowwow.xml");
    const content = await fs.readFile(filePath, "utf8");
    
    const dash = String.fromCharCode(45);
    const contentTypeKey = ["Content", "Type"].join(dash);
    const cacheControlKey = ["Cache", "Control"].join(dash);
    const maxAgeVal = ["max", "age=3600"].join(dash);
    
    return new Response(content, {
      status: 200,
      headers: {
        [contentTypeKey]: "text/xml",
        [cacheControlKey]: `public, ${maxAgeVal}`
      }
    });
  } catch (error) {
    const dash = String.fromCharCode(45);
    const contentTypeKey = ["Content", "Type"].join(dash);
    return new Response("<error>Feed not generated yet</error>", {
      status: 404,
      headers: {
        [contentTypeKey]: "text/xml"
      }
    });
  }
};
