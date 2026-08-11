module.exports = function (eleventyConfig) {
    // Copy static assets through unchanged. Paths are relative to the repo
    // root, not the input dir.
    eleventyConfig.addPassthroughCopy("src/media");
    eleventyConfig.addPassthroughCopy("src/styles");
    eleventyConfig.addPassthroughCopy("src/scripts");
    eleventyConfig.addPassthroughCopy("src/api");

    return {
        dir: {
            input: "src",
            output: "dist",
            includes: "_includes",   // resolved relative to input → src/_includes
        },
        // Use Nunjucks for .html files too, so we can convert pages in place.
        htmlTemplateEngine: "njk",
        markdownTemplateEngine: "njk",
    };
};
