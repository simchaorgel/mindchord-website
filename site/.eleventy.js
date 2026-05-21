module.exports = function (eleventyConfig) {
    // Copy static assets through unchanged. The path is relative to the
    // input dir (src/), so this picks up everything in src/media/ and
    // src/global_style.css.
    eleventyConfig.addPassthroughCopy("site/src/media");
    eleventyConfig.addPassthroughCopy("site/src/styles");
    eleventyConfig.addPassthroughCopy("site/src/scripts");

    return {
        dir: {
            input: "site/src",
            output: "dist",
            includes: "_includes",   // resolved relative to input → site/src/_includes
        },
        // Use Nunjucks for .html files too, so we can convert pages in place.
        htmlTemplateEngine: "njk",
        markdownTemplateEngine: "njk",
    };
};
